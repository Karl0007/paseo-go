// R2-02 regression (通知进入): the tapped attention notification only ever stamped
// the FIRST beat — the visit itself was never recorded, so activity watched inside
// the session resurfaced as unread on return. The tap must put the visit on the
// ledger (module-level, survives whatever the tab screens do), and a cold tap with
// an unloaded directory must keep its no-bogus-watermark posture (no entry stamp)
// while still tracking the visit for the later settle.
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  listeners: [] as ((response: unknown) => void)[],
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
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: env.sessions }) },
}));

import {
  pendingVisits,
  registerVisitLedgerDeps,
  resetVisitLedger,
  settleVisits,
} from "@/shell/chats/visit-ledger";
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
