// C4 acceptance: markRead trigger timing — entry stamp, return stamp, and the
// no-op cases (first focus, focus without a visit, stale pending after a second
// visit). Navigation itself is the official navigateToAgent's job; the opener is
// only judged on "called exactly once, with the target's ids".
import { describe, expect, it, vi } from "vitest";
import { createChatOpener, type ChatOpenTarget } from "./open-agent";

const T0 = 1_700_000_000_000;

function harness() {
  let clock = T0;
  const markRead = vi.fn();
  const navigateToAgent = vi.fn();
  const opener = createChatOpener({
    markRead,
    navigateToAgent,
    now: () => clock,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { opener, markRead, navigateToAgent, advance };
}

const target: ChatOpenTarget = {
  key: "srv-1:agent-9",
  serverId: "srv-1",
  agentId: "agent-9",
  workspaceId: "ws-7",
};

describe("createChatOpener", () => {
  it("marks read at press time and navigates once with the target's ids", () => {
    const { opener, markRead, navigateToAgent } = harness();
    opener.open(target);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(target.key, T0);
    expect(navigateToAgent).toHaveBeenCalledTimes(1);
    expect(navigateToAgent).toHaveBeenCalledWith({
      serverId: "srv-1",
      agentId: "agent-9",
      workspaceId: "ws-7",
    });
  });

  it("re-marks on return so activity watched during the visit stays read", () => {
    const { opener, markRead, advance } = harness();
    opener.open(target);
    advance(60_000);
    opener.onFocus();
    expect(markRead).toHaveBeenNthCalledWith(2, target.key, T0 + 60_000);
  });

  it("clears nothing on the screen's first focus or any focus without a visit", () => {
    const { opener, markRead } = harness();
    opener.onFocus();
    opener.onFocus();
    expect(markRead).not.toHaveBeenCalled();
  });

  it("the return stamp only ever clears the most recent visit", () => {
    const { opener, markRead } = harness();
    const other: ChatOpenTarget = { ...target, key: "srv-1:agent-2", agentId: "agent-2" };
    opener.open(target);
    opener.open(other);
    markRead.mockClear();
    opener.onFocus();
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(other.key, T0);
    // The pending slot is consumed: a further focus clears nothing.
    markRead.mockClear();
    opener.onFocus();
    expect(markRead).not.toHaveBeenCalled();
  });

  it("passes a missing workspaceId through for the official cold deep-link fallback", () => {
    const { opener, navigateToAgent } = harness();
    opener.open({ ...target, workspaceId: null });
    expect(navigateToAgent).toHaveBeenCalledWith({
      serverId: "srv-1",
      agentId: "agent-9",
      workspaceId: null,
    });
  });
});
