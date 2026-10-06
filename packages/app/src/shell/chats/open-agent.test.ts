// C4 acceptance + F4 review fix: the read watermark must live in the chat's own
// (host-clock) domain — markRead stamps with the chat's last-event stamp, never the
// device wall clock, or a host clock behind the device makes every chat permanently
// read (device stamp above all host stamps) or permanently unread. markRead timing:
// entry stamp, return stamp, no-op cases. Navigation itself is the official
// navigateToAgent's job; the opener is judged on "called exactly once, with the
// target's ids". F37 (批次十): the opener is gate-free — both open-time dialogs
// (C24 fork, B4-R4OPEN ownership) were removed after the resume-on-open premise
// was falsified; the send guard is the single warning point.
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
  const deps: ChatOpenerDeps = {
    markRead,
    navigateToAgent,
    lastEventAtOf,
    section: "chats",
  };
  return { opener: createChatOpener(deps), markRead, navigateToAgent, lastEventAtOf };
}

const target: ChatOpenTarget = {
  key: "srv-1:agent-9",
  serverId: "srv-1",
  agentId: "agent-9",
  workspaceId: "ws-7",
  lastEventAt: HOST_EVENT,
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

describe("F37: no open-time dialogs", () => {
  it("opens an imported chat synchronously — no confirm, no ack, one navigation", async () => {
    // The C24 fork dialog and the B4-R4OPEN graded confirm are GONE: opening
    // is read-only browsing (the falsified resume-on-open premise, card F37).
    // The composer send guard owns the fork warning at the real fork moment.
    const { opener, markRead, navigateToAgent, lastEventAtOf } = harness();
    await opener.open(target);
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(target.key, target.lastEventAt);
    // The synchronous open never consults the directory for a re-stamp.
    expect(lastEventAtOf).not.toHaveBeenCalled();
  });
});
