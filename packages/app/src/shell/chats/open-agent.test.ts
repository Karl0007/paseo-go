// C4 acceptance + F4 review fix: the read watermark must live in the chat's own
// (host-clock) domain — markRead stamps with the chat's last-event stamp, never the
// device wall clock, or a host clock behind the device makes every chat permanently
// read (device stamp above all host stamps) or permanently unread. markRead timing:
// entry stamp, return stamp, no-op cases. Navigation itself is the official
// navigateToAgent's job; the opener is judged on "called exactly once, with the
// target's ids". C24 adds the fork guard: an imported chat's first open awaits the
// injected confirmation BEFORE any stamp or navigation; confirming acks once.
import { describe, expect, it, vi } from "vitest";
import { isChatUnread } from "./derive";
import { createChatOpener, type ChatOpenTarget, type ChatOpenerDeps } from "./open-agent";

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

  it("the return stamp only ever clears the most recent visit", async () => {
    const { opener, markRead } = harness();
    const other: ChatOpenTarget = { ...target, key: "srv-1:agent-2", agentId: "agent-2" };
    await opener.open(target);
    await opener.open(other);
    markRead.mockClear();
    opener.onFocus();
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(other.key, HOST_EVENT);
    markRead.mockClear();
    opener.onFocus();
    expect(markRead).not.toHaveBeenCalled();
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
});
