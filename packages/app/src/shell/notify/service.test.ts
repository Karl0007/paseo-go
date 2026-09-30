// R2-02 regression (通知进入): the tapped attention notification only ever stamped
// the FIRST beat — the visit itself was never recorded, so activity watched inside
// the session resurfaced as unread on return. The tap must put the visit on the
// ledger (module-level, survives whatever the tab screens do), and a cold tap with
// an unloaded directory must keep its no-bogus-watermark posture (no entry stamp),
// while still tracking the visit for the later settle.
// R4-32 (开屏=危险时刻覆盖面收口) adds the graded open gate in front of ALL of
// it: an external·运行中 row confirms with the same table/copy as the row-open
// guard BEFORE anything is stamped; cancel = no navigate, no dismiss, and the
// dedup releases so a re-tap re-asks. The fork gate deliberately never runs on
// this path (Main 裁定: 通知 tap=查看, not 续写).
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  listeners: [] as ((response: unknown) => unknown)[],
  sessions: {} as Record<string, { agents: Map<string, unknown> }>,
}));

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn((cb: (response: unknown) => void) => {
    env.listeners.push(cb);
    return { remove: () => {} };
  }),
  getLastNotificationResponseAsync: vi.fn(async () => null),
  dismissNotificationAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async () => "note-1"),
  getPermissionsAsync: vi.fn(async () => ({ status: "granted", canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  PermissionStatus: { GRANTED: "granted" },
}));
vi.mock("@/shell/chats/shell-navigate-to-agent", () => ({ shellNavigateToAgent: vi.fn() }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo" }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: env.sessions }) },
}));

import {
  pendingVisits,
  registerVisitLedgerDeps,
  resetVisitLedger,
  settleVisits,
} from "@/shell/chats/visit-ledger";
import * as Notifications from "expo-notifications";
import { confirmDialog } from "@/utils/confirm-dialog";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { encodeAttentionPayload, type AttentionPayload } from "./payload";
import { startShellNotifyService } from "./service";

const HOST_EVENT = 1_700_000_060_000;
const payload: AttentionPayload = { serverId: "srv-1", agentId: "agent-9", workspaceId: null };
const KEY = "srv-1:agent-9";

function responseFor(identifier: string) {
  return {
    notification: { request: { identifier, content: { data: encodeAttentionPayload(payload) } } },
  };
}

beforeEach(() => {
  resetVisitLedger();
  usePaseoGoReadStateStore.setState({ lastReadAt: {} });
  env.sessions = {};
  vi.mocked(shellNavigateToAgent).mockClear();
  vi.mocked(confirmDialog).mockClear();
  vi.mocked(confirmDialog).mockResolvedValue(true);
  vi.mocked(Notifications.dismissNotificationAsync).mockClear();
});

describe("notification tap records the visit (R2-02)", () => {
  it("warm tap: entry stamp lands AND the visit reaches the ledger for the return beat", () => {
    const markRead = vi.fn();
    registerVisitLedgerDeps({ lastEventAtOf: () => HOST_EVENT + 30_000, markRead });
    env.sessions = {
      "srv-1": {
        agents: new Map([
          [
            "agent-9",
            { lastActivityAt: new Date(HOST_EVENT), attentionTimestamp: new Date(HOST_EVENT) },
          ],
        ]),
      },
    };
    startShellNotifyService("test-channel");
    env.listeners.at(-1)!(responseFor("n-warm"));

    // First beat unchanged: the row reads as seen on entry.
    expect(usePaseoGoReadStateStore.getState().lastReadAt[KEY]).toBe(HOST_EVENT);
    expect(shellNavigateToAgent).toHaveBeenCalledWith(payload);
    // Second beat (the regression): the visit is on the ledger, so leaving the
    // session stamps what was watched inside it instead of resurfacing unread.
    expect(pendingVisits().map((slot) => slot.key)).toEqual([KEY]);
    expect(pendingVisits()[0]?.section).toBe("chats");
    settleVisits("focus-return");
    expect(markRead).toHaveBeenCalledWith(KEY, HOST_EVENT + 30_000);
  });

  it("cold tap (directory not loaded): no bogus entry stamp, the visit is still tracked", () => {
    const markRead = vi.fn();
    registerVisitLedgerDeps({ lastEventAtOf: () => undefined, markRead });
    startShellNotifyService("test-channel");
    env.listeners.at(-1)!(responseFor("n-cold"));

    // F4/cold-start doctrine: an unloaded directory leaves the dot rather than
    // writing a watermark that would swallow every host event.
    expect(usePaseoGoReadStateStore.getState().lastReadAt[KEY]).toBeUndefined();
    expect(markRead).not.toHaveBeenCalled();
    // The visit is still tracked — with no entry floor (0 = nothing trustworthy).
    expect(pendingVisits().map((slot) => slot.key)).toEqual([KEY]);
    expect(pendingVisits()[0]?.at).toBe(0);
    // Once the row loads, leaving settles with the loaded stamp.
    registerVisitLedgerDeps({ lastEventAtOf: () => HOST_EVENT + 60_000, markRead });
    settleVisits("focus-return");
    expect(markRead).toHaveBeenCalledWith(KEY, HOST_EVENT + 60_000);
  });
});

// The gate reads the SAME table (ownership.ts) the open-agent suite pins; what
// this suite pins is the WIRING on the tap path: when it asks, that a cancel is a
// pure no-op, that a confirm re-takes the watermark, and that the dedup neither
// double-asks nor strands a cancelled notification.
describe("notification tap passes the graded open gate (R4-32)", () => {
  function externalRow(overrides: Record<string, unknown> = {}) {
    return {
      lastActivityAt: new Date(HOST_EVENT),
      attentionTimestamp: new Date(HOST_EVENT),
      ownership: "external",
      externalLooksActive: true,
      provider: "claude",
      ...overrides,
    };
  }
  function setRow(row: unknown | null) {
    env.sessions = row ? { "srv-1": { agents: new Map([["agent-9", row]]) } } : {};
  }
  // No wall-clock waits: openFromResponse IS an async function, so the promise
  // the listener call returns resolves exactly when the tap finished — that is
  // the signal, not a guessed duration.

  it("cancel: the dialog uses the open copy and NOTHING is stamped, visited, navigated or dismissed", async () => {
    setRow(externalRow());
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    startShellNotifyService("test-channel");
    await env.listeners.at(-1)!(responseFor("n-gate-cancel"));
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "paseoGo:chats.ownership.sendTitle",
        message: "paseoGo:chats.ownership.sendBody",
        confirmLabel: "paseoGo:chats.ownership.openConfirm",
        cancelLabel: "paseoGo:chats.ownership.sendCancel",
      }),
    );
    expect(usePaseoGoReadStateStore.getState().lastReadAt[KEY]).toBeUndefined();
    expect(pendingVisits()).toEqual([]);
    expect(shellNavigateToAgent).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it("confirm: the stamp is re-taken after the dialog (R2-10), then the tap completes", async () => {
    setRow(externalRow());
    startShellNotifyService("test-channel");
    const tap = env.listeners.at(-1)!(responseFor("n-gate-confirm"));
    // Activity lands WHILE the dialog is up — the press-time row must not mark it seen.
    setRow(externalRow({ lastActivityAt: new Date(HOST_EVENT + 45_000) }));
    await tap;
    expect(usePaseoGoReadStateStore.getState().lastReadAt[KEY]).toBe(HOST_EVENT + 45_000);
    expect(shellNavigateToAgent).toHaveBeenCalledWith(payload);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("n-gate-confirm");
    expect(pendingVisits().map((slot) => slot.key)).toEqual([KEY]);
  });

  it("opencode external·运行中 goes straight through — same table, no dialog", async () => {
    setRow(externalRow({ provider: "opencode" }));
    startShellNotifyService("test-channel");
    await env.listeners.at(-1)!(responseFor("n-gate-oce"));
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(shellNavigateToAgent).toHaveBeenCalledWith(payload);
  });

  it("re-tap after a cancel re-asks (the dedup released with the cancelled tap)", async () => {
    setRow(externalRow());
    vi.mocked(confirmDialog).mockResolvedValue(false);
    startShellNotifyService("test-channel");
    await env.listeners.at(-1)!(responseFor("n-gate-retap"));
    await env.listeners.at(-1)!(responseFor("n-gate-retap"));
    expect(confirmDialog).toHaveBeenCalledTimes(2);
    expect(shellNavigateToAgent).not.toHaveBeenCalled();
  });

  it("a duplicate response while the dialog is up raises no second dialog", async () => {
    const gate = Promise.withResolvers<boolean>();
    vi.mocked(confirmDialog).mockImplementationOnce(() => gate.promise);
    setRow(externalRow());
    startShellNotifyService("test-channel");
    const first = env.listeners.at(-1)!(responseFor("n-gate-dup"));
    await env.listeners.at(-1)!(responseFor("n-gate-dup"));
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    gate.resolve(true);
    await first;
    expect(shellNavigateToAgent).toHaveBeenCalledTimes(1);
  });
});
