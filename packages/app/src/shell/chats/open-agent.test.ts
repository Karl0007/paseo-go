// C4 acceptance + F4 review fix: the read watermark must live in the chat's own
// (host-clock) domain — markRead stamps with the chat's last-event stamp, never the
// device wall clock, or a host clock behind the device makes every chat permanently
// read (device stamp above all host stamps) or permanently unread. markRead timing:
// entry stamp, return stamp, no-op cases. Navigation itself is the official
// navigateToAgent's job; the opener is judged on "called exactly once, with the
// target's ids". C24 adds the fork guard: an imported chat's first open awaits the
// injected confirmation BEFORE any stamp or navigation; confirming acks once.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isChatUnread } from "./derive";
import { createChatOpener, type ChatOpenTarget, type ChatOpenerDeps } from "./open-agent";
import { resetVisitLedger, settleVisits } from "./visit-ledger";

const DEVICE_NOW = 1_700_000_000_000; // device wall clock, 1h ahead of the host
const HOST_LAG = 3_600_000;
const HOST_EVENT = DEVICE_NOW - HOST_LAG + 60_000; // recent event, still < DEVICE_NOW

function harness(latestHostEvent = HOST_EVENT) {
  const markRead = vi.fn();
  const navigateToAgent = vi.fn();
  const lastEventAtOf = vi.fn(() => latestHostEvent);
  const confirmFork = vi.fn(async () => true);
  const acked = new Set<string>();
  const acknowledgeFork = vi.fn((key: string) => {
    acked.add(key);
  });
  const forkAcknowledged = (key: string) => acked.has(key);
  const deps: ChatOpenerDeps = {
    markRead,
    navigateToAgent,
    lastEventAtOf,
    confirmFork,
    forkAcknowledged,
    acknowledgeFork,
    section: "chats",
  };
  return {
    opener: createChatOpener(deps),
    markRead,
    navigateToAgent,
    lastEventAtOf,
    confirmFork,
    acked,
  };
}

const target: ChatOpenTarget = {
  key: "srv-1:agent-9",
  serverId: "srv-1",
  agentId: "agent-9",
  workspaceId: "ws-7",
  lastEventAt: HOST_EVENT,
  imported: false,
};

// The ledger is module-global (like the section bus); every test starts clean.
beforeEach(() => {
  resetVisitLedger();
});

describe("createChatOpener", () => {
  it("stamps the chat's own last-event clock, keeping unread semantics under host skew", async () => {
    const { opener, markRead } = harness();
    await opener.open(target);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(target.key, HOST_EVENT);

    // Same-domain comparison: seen → read; a newer host *attention* event → unread
    // again. C18 gated unread on attention, so the skew probe rides the attention
    // stamp; activity alone must stay read no matter how fresh it is.
    const chat = {
      key: target.key,
      serverId: target.serverId,
      bucket: "running" as const,
      lastActivityAt: HOST_EVENT,
      attentionTimestamp: null,
    };
    expect(isChatUnread(chat, HOST_EVENT)).toBe(false);
    expect(isChatUnread({ ...chat, lastActivityAt: HOST_EVENT + 1 }, HOST_EVENT)).toBe(false);
    const completed = {
      ...chat,
      lastActivityAt: HOST_EVENT + 1,
      attentionTimestamp: HOST_EVENT + 1,
    };
    expect(isChatUnread(completed, HOST_EVENT)).toBe(true);
    // The pre-fix device-clock watermark (DEVICE_NOW) would have swallowed every
    // future host event: host stamps stay below DEVICE_NOW for the whole lag hour.
    expect(isChatUnread(completed, DEVICE_NOW)).toBe(false);
  });

  it("re-marks on return with the fresh host stamp so watched activity stays read", async () => {
    const during = HOST_EVENT + 45_000; // activity that happened inside the visit
    const markRead = vi.fn();
    const opener = createChatOpener({
      markRead,
      navigateToAgent: vi.fn(),
      lastEventAtOf: () => during,
      confirmFork: async () => true,
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    await opener.open(target);
    opener.onFocus();
    expect(markRead).toHaveBeenNthCalledWith(2, target.key, during);
  });

  it("never lowers the watermark when the host clock stepped back", async () => {
    const older = HOST_EVENT - 10_000;
    const { opener, markRead } = harness(older);
    await opener.open(target);
    opener.onFocus();
    expect(markRead).toHaveBeenNthCalledWith(2, target.key, HOST_EVENT);
  });

  it("keeps the pending visit when the directory has no row yet, stamps on a later focus", async () => {
    const markRead = vi.fn();
    let known: number | undefined;
    const opener = createChatOpener({
      markRead,
      navigateToAgent: vi.fn(),
      lastEventAtOf: () => known,
      confirmFork: async () => true,
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    await opener.open(target);
    opener.onFocus(); // directory empty: nothing stamped, visit still pending
    expect(markRead).toHaveBeenCalledTimes(1);
    known = HOST_EVENT + 5_000;
    opener.onFocus();
    expect(markRead).toHaveBeenCalledTimes(2);
    expect(markRead).toHaveBeenNthCalledWith(2, target.key, known);
  });

  it("clears nothing on the screen's first focus or any focus without a visit", () => {
    const { opener, markRead } = harness();
    opener.onFocus();
    opener.onFocus();
    expect(markRead).not.toHaveBeenCalled();
  });

  // R2-03 (结算时点): the switch to B is A's LEAVE moment — A settles right there,
  // with the watermark read then. The return beat afterwards settles only B, and
  // a beat after an empty ledger clears nothing (settlement is idempotent).
  it("opening B settles A at once; the return beat then settles only B", async () => {
    let fresh = HOST_EVENT;
    const markRead = vi.fn();
    const opener = createChatOpener({
      markRead,
      navigateToAgent: vi.fn(),
      lastEventAtOf: () => fresh,
      confirmFork: async () => true,
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    const other: ChatOpenTarget = { ...target, key: "srv-1:agent-2", agentId: "agent-2" };
    await opener.open(target); // #1: entry A @ HOST_EVENT
    fresh = HOST_EVENT + 30_000; // activity watched inside A's visit
    await opener.open(other); // #2: entry B, then #3: A settles AT THE SWITCH
    expect(markRead).toHaveBeenNthCalledWith(2, other.key, HOST_EVENT);
    expect(markRead).toHaveBeenNthCalledWith(3, target.key, HOST_EVENT + 30_000);
    markRead.mockClear();
    opener.onFocus(); // return beat: only B is left on the ledger
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(other.key, HOST_EVENT + 30_000);
    markRead.mockClear();
    opener.onFocus();
    expect(markRead).not.toHaveBeenCalled();
  });

  // R2-02 regression (分栏翻转丢拍): the pending visit lived in the opener's
  // closure; a body remount (wide↔compact flip, section switch) hands the screen
  // a FRESH opener whose return beat settled nothing — the visit was lost. The
  // visit must outlive the opener instance that recorded it (module ledger).
  it("a NEW opener instance settles the visit an older instance recorded", async () => {
    const first = harness();
    await first.opener.open(target);
    const second = harness(); // body remount: fresh opener, same pending visit
    second.opener.onFocus();
    expect(second.markRead).toHaveBeenCalledWith(target.key, HOST_EVENT);
  });

  // R2-02 regression (覆盖点 B): opening B overwrote A's single pending slot —
  // A's return beat was lost and A's watched activity resurfaced as unread.
  // Both visits must settle, each with its own watermark.
  it("settles BOTH visits when B is opened over a still-pending A", async () => {
    const { opener, markRead } = harness();
    const other: ChatOpenTarget = { ...target, key: "srv-1:agent-2", agentId: "agent-2" };
    await opener.open(target);
    await opener.open(other); // wide: the detail swaps A→B without any focus event
    opener.onFocus();
    const stamps = markRead.mock.calls.map(([key]) => key);
    expect(stamps.filter((k) => k === target.key)).toHaveLength(2); // entry + settle
    expect(stamps.filter((k) => k === other.key)).toHaveLength(2);
  });

  // R2-03 regression (结算时点): leaving the session settles the visit AT THAT
  // MOMENT. Activity that lands afterwards must re-arm the unread flag — a late
  // focus beat must never stamp it as seen (the wide-screen silent-read chain).
  it("leaving settles the visit immediately; later attention is not swallowed", async () => {
    let fresh = HOST_EVENT;
    const markRead = vi.fn();
    const opener = createChatOpener({
      markRead,
      navigateToAgent: vi.fn(),
      lastEventAtOf: () => fresh,
      confirmFork: async () => true,
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    await opener.open(target);
    expect(settleVisits("section-switch")).toEqual([target.key]); // leave = NOW
    expect(markRead).toHaveBeenCalledTimes(2); // entry + settle, nothing later
    fresh = HOST_EVENT + 60_000; // activity AFTER leaving
    opener.onFocus(); // late compensation beat
    expect(markRead).toHaveBeenCalledTimes(2); // stamped nothing
    // The new attention event surfaces as unread instead of being swallowed.
    expect(
      isChatUnread(
        {
          key: target.key,
          serverId: target.serverId,
          bucket: "done",
          lastActivityAt: fresh,
          attentionTimestamp: fresh,
        },
        HOST_EVENT,
      ),
    ).toBe(true);
  });

  it("navigates once with the target's ids, passing a missing workspaceId through", async () => {
    const { opener, navigateToAgent } = harness();
    await opener.open({ ...target, workspaceId: null });
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
    expect(navigateToAgent).toHaveBeenCalledWith({
      serverId: "srv-1",
      agentId: "agent-9",
      workspaceId: null,
    });
  });
});

describe("C24 fork guard (imported chats)", () => {
  const importedTarget: ChatOpenTarget = { ...target, imported: true };

  it("asks once before the FIRST open, then acks and never asks again", async () => {
    const { opener, markRead, navigateToAgent, confirmFork, acked } = harness();
    await opener.open(importedTarget);
    expect(confirmFork).toHaveBeenCalledTimes(1);
    expect(acked.has(importedTarget.key)).toBe(true);
    expect(markRead).toHaveBeenCalledWith(importedTarget.key, HOST_EVENT);
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
    // Second open: acknowledged → straight in, no dialog.
    await opener.open(importedTarget);
    expect(confirmFork).toHaveBeenCalledTimes(1);
    expect(navigateToAgent).toHaveBeenCalledTimes(2);
  });

  it("a cancelled warning stays on the list: no navigation, no read stamp, no ack", async () => {
    const { opener, markRead, navigateToAgent, confirmFork, acked } = harness();
    confirmFork.mockResolvedValue(false);
    await opener.open(importedTarget);
    expect(confirmFork).toHaveBeenCalledTimes(1);
    expect(navigateToAgent).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(acked.size).toBe(0);
    // Still unacknowledged → the next tap warns again.
    await opener.open(importedTarget);
    expect(confirmFork).toHaveBeenCalledTimes(2);
    expect(navigateToAgent).not.toHaveBeenCalled();
  });

  it("holds the read stamp and navigation until the dialog resolves", async () => {
    let release: (proceed: boolean) => void = () => {};
    const markRead = vi.fn();
    const navigateToAgent = vi.fn();
    const opener = createChatOpener({
      markRead,
      navigateToAgent,
      lastEventAtOf: () => HOST_EVENT,
      confirmFork: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    const opening = opener.open(importedTarget);
    await Promise.resolve();
    expect(markRead).not.toHaveBeenCalled();
    expect(navigateToAgent).not.toHaveBeenCalled();
    release(true);
    await opening;
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
  });

  it("native (unstamped) chats never see the warning", async () => {
    const { opener, navigateToAgent, confirmFork } = harness();
    await opener.open(target);
    expect(confirmFork).not.toHaveBeenCalled();
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
  });

  // R2-10 (FIX-A): the confirm dialog suspends the open — the directory can
  // advance while the user reads the fork warning. Stamping with the press-time
  // snapshot then marks activity that happened DURING the dialog as read
  // without anyone watching it. After the gate passes, the watermark must be
  // re-read via lastEventAtOf; the snapshot is only the fallback for a row the
  // directory lost mid-dialog.
  it("re-reads the watermark after the confirm: dialog-window activity is not silently seen", async () => {
    let directoryEvent: number | undefined = HOST_EVENT;
    const markRead = vi.fn();
    const opener = createChatOpener({
      markRead,
      navigateToAgent: vi.fn(),
      lastEventAtOf: () => directoryEvent,
      confirmFork: async () => {
        directoryEvent = HOST_EVENT + 5_000; // activity during the dialog
        return true;
      },
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    await opener.open(importedTarget); // target.lastEventAt = HOST_EVENT (press snapshot)
    expect(markRead).toHaveBeenCalledWith(importedTarget.key, HOST_EVENT + 5_000);
  });

  it("falls back to the press snapshot when the directory lost the row mid-confirm", async () => {
    let directoryEvent: number | undefined = HOST_EVENT;
    const markRead = vi.fn();
    const navigateToAgent = vi.fn();
    const opener = createChatOpener({
      markRead,
      navigateToAgent,
      lastEventAtOf: () => directoryEvent,
      confirmFork: async () => {
        directoryEvent = undefined;
        return true;
      },
      forkAcknowledged: () => false,
      acknowledgeFork: () => {},
      section: "chats",
    });
    await opener.open(importedTarget);
    expect(markRead).toHaveBeenCalledWith(importedTarget.key, HOST_EVENT);
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
  });

  it("the synchronous non-imported path never re-reads the directory (unchanged F4 open)", async () => {
    const { opener, markRead, lastEventAtOf } = harness();
    await opener.open(target);
    expect(markRead).toHaveBeenCalledWith(target.key, HOST_EVENT);
    expect(lastEventAtOf).not.toHaveBeenCalled();
  });
});
