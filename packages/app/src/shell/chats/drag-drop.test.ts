// KI-11 ruling ③+④ unit contract: the drop's MEANING (zone boundary) and its
// dispatch (the same action-layer calls the menu buttons make — proven against
// the REAL actions + the REAL pins store, not a stub), plus the refresh gate
// that keeps a long-pressed downward drag from pulling the spinner.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { chatRefreshGateProps, decidePinDrop, dispatchPinDrop } from "@/shell/chats/drag-drop";
import { createShellAgentActions, type ShellChatTarget } from "@/shell/shellAgentActions";

// Only `key` reaches the store writes; the rest of the target is carried.
const targetOfKey = (key: string): ShellChatTarget => ({
  key,
  serverId: "s1",
  agentId: key,
});

beforeEach(() => {
  usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
});

describe("decidePinDrop: zone boundary decides the drop's meaning", () => {
  const pinned = ["p1", "p2", "p3"];

  it("an unpinned row dropped INSIDE the group pins at the counted slot", () => {
    expect(
      decidePinDrop({
        droppedKey: "u1",
        visibleRowKeys: ["p1", "u1", "p2", "p3"],
        pinnedIds: pinned,
      }),
    ).toEqual({ kind: "pin-at", key: "u1", index: 1 });
  });

  it("an unpinned row dropped above an empty group still pins at 0 (drag creates the first pin)", () => {
    expect(
      decidePinDrop({ droppedKey: "u1", visibleRowKeys: ["u1", "r1", "r2"], pinnedIds: [] }),
    ).toEqual({ kind: "pin-at", key: "u1", index: 0 });
  });

  it("an unpinned row moved within/below the time-derived zone persists NOTHING (KI-11: 区内=纯排序)", () => {
    // The old C20 rule pinned on ANY drop — a downward shuffle in 最近 pinned
    // the row by accident. Now the zone test says no.
    expect(
      decidePinDrop({
        droppedKey: "u1",
        visibleRowKeys: ["p1", "r1", "u1", "r2"],
        pinnedIds: pinned,
      }),
    ).toEqual({ kind: "none" });
    expect(
      decidePinDrop({ droppedKey: "u1", visibleRowKeys: ["r1", "u1", "r2"], pinnedIds: pinned }),
    ).toEqual({ kind: "none" });
  });

  it("a pinned row dragged OUT of the group (an unpinned row above it) UNPINS", () => {
    // This is the ruling ④ fork: pre-KI-11 this drop persisted a no-op reorder
    // and the row snapped back while the menu button unpinned it.
    expect(
      decidePinDrop({
        droppedKey: "p3",
        visibleRowKeys: ["p1", "p2", "r1", "p3", "r2"],
        pinnedIds: pinned,
      }),
    ).toEqual({ kind: "unpin", key: "p3" });
    // Dragged all the way to the offline tail — same verdict.
    expect(
      decidePinDrop({
        droppedKey: "p1",
        visibleRowKeys: ["p2", "p3", "r1", "p1"],
        pinnedIds: pinned,
      }),
    ).toEqual({ kind: "unpin", key: "p1" });
  });

  it("a pinned row moved within the group reorders with the visible pinned order", () => {
    expect(
      decidePinDrop({
        droppedKey: "p1",
        visibleRowKeys: ["p2", "p1", "p3", "r1"],
        pinnedIds: pinned,
      }),
    ).toEqual({ kind: "reorder", orderedPinnedKeys: ["p2", "p1", "p3"] });
  });

  it("a pinned row dragged to the very top stays pinned at slot 0", () => {
    expect(
      decidePinDrop({
        droppedKey: "p3",
        visibleRowKeys: ["p3", "p1", "p2", "r1"],
        pinnedIds: pinned,
      }),
    ).toEqual({ kind: "reorder", orderedPinnedKeys: ["p3", "p1", "p2"] });
  });

  it("a drop without a recorded drag-start keeps the C3 belt: reorder the visible pins", () => {
    expect(
      decidePinDrop({ droppedKey: null, visibleRowKeys: ["p2", "p1", "r1"], pinnedIds: pinned }),
    ).toEqual({ kind: "reorder", orderedPinnedKeys: ["p2", "p1"] });
  });

  it("stale pins hidden from the directory never enter the reorder", () => {
    expect(
      decidePinDrop({
        droppedKey: "p1",
        visibleRowKeys: ["p2", "p1"],
        pinnedIds: ["p1", "gone", "p2"],
      }),
    ).toEqual({ kind: "reorder", orderedPinnedKeys: ["p2", "p1"] });
  });
});

describe("dispatchPinDrop: cross-zone drops run the SAME actions the buttons run (ruling ④)", () => {
  function realActions() {
    const deps = {
      t: (key: string) => key,
      notify: vi.fn(),
      reportError: vi.fn(),
      getClient: vi.fn(() => null),
      confirm: vi.fn(async () => true),
      haptic: vi.fn(),
    };
    return { actions: createShellAgentActions(deps), deps };
  }

  it("拖入置顶 dispatch == 按钮 pin: identical store state, haptic and toast", () => {
    usePaseoGoPinsStore.setState({ pinnedIds: ["b1", "b2"] });
    const viaButton = realActions();
    viaButton.actions.pin(targetOfKey("u9"));

    usePaseoGoPinsStore.setState({ pinnedIds: ["b1", "b2"] });
    const viaDrag = realActions();
    dispatchPinDrop(
      { kind: "pin-at", key: "u9", index: 1 },
      {
        actions: viaDrag.actions,
        targetOf: targetOfKey,
      },
    );

    // The button appends at the tail; the drag places at the slot — same
    // action, same side effects; here the tail happens to be slot 2.
    usePaseoGoPinsStore.setState({ pinnedIds: ["b1", "b2"] });
    const viaButtonTail = realActions();
    viaButtonTail.actions.pin(targetOfKey("u9"), 2);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["b1", "b2", "u9"]);

    expect(viaDrag.deps.notify).toHaveBeenCalledTimes(1);
    expect(viaDrag.deps.notify).toHaveBeenCalledWith("chats.toast.pinned");
    expect(viaDrag.deps.haptic).toHaveBeenCalledTimes(1);
    expect(viaButton.deps.notify).toHaveBeenCalledTimes(1);
  });

  it("拖出置顶 dispatch == 按钮 unpin: identical store state, haptic and toast", () => {
    usePaseoGoPinsStore.setState({ pinnedIds: ["p1", "p2"] });
    const viaButton = realActions();
    viaButton.actions.unpin(targetOfKey("p1"));
    const buttonState = usePaseoGoPinsStore.getState().pinnedIds;

    usePaseoGoPinsStore.setState({ pinnedIds: ["p1", "p2"] });
    const viaDrag = realActions();
    dispatchPinDrop(
      { kind: "unpin", key: "p1" },
      { actions: viaDrag.actions, targetOf: targetOfKey },
    );

    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(buttonState);
    expect(viaDrag.deps.notify).toHaveBeenCalledWith("chats.toast.unpinned");
    expect(viaDrag.deps.haptic).toHaveBeenCalledTimes(1);
  });

  it("区内 reorder dispatch persists the group order through reorderPinned", () => {
    usePaseoGoPinsStore.setState({ pinnedIds: ["p1", "p2", "p3"] });
    const { actions, deps } = realActions();
    dispatchPinDrop(
      { kind: "reorder", orderedPinnedKeys: ["p3", "p1", "p2"] },
      {
        actions,
        targetOf: targetOfKey,
      },
    );
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["p3", "p1", "p2"]);
    expect(deps.notify).not.toHaveBeenCalled(); // a reorder is not a pin toast
  });

  it("a vanished row (no target) dispatches nothing — no store write, no toast", () => {
    usePaseoGoPinsStore.setState({ pinnedIds: ["p1"] });
    const { actions, deps } = realActions();
    dispatchPinDrop(
      { kind: "pin-at", key: "ghost", index: 0 },
      {
        actions,
        targetOf: () => null,
      },
    );
    dispatchPinDrop({ kind: "unpin", key: "ghost" }, { actions, targetOf: () => null });
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["p1"]);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("区内-none never touches the store (an empty reorder would wipe the group)", () => {
    usePaseoGoPinsStore.setState({ pinnedIds: ["p1", "p2"] });
    const { actions } = realActions();
    dispatchPinDrop({ kind: "none" }, { actions, targetOf: targetOfKey });
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["p1", "p2"]);
  });
});

describe("chatRefreshGateProps (ruling ③)", () => {
  const handleRefresh = () => {};

  it("a live row gesture keeps the control MOUNTED but idle: refreshing=false, onRefresh retained", () => {
    // B4-REGRESS F10: dropping onRefresh made the official wrapper UNMOUNT the
    // RefreshControl, and the FlatList then remounted every cell — each row's
    // unmount `closeFor` destroyed the just-opened long-press menu (menu opened
    // then vanished ~400ms later). The control must stay mounted; the downward
    // pull is suppressed by the co-riding `scrollEnabled={!gestureLock}` lock,
    // not by removing the control.
    expect(
      chatRefreshGateProps({ gestureLive: true, refreshing: true, onRefresh: handleRefresh }),
    ).toEqual({
      refreshing: false,
      onRefresh: handleRefresh,
    });
    expect(
      chatRefreshGateProps({ gestureLive: true, refreshing: false, onRefresh: handleRefresh }),
    ).toEqual({
      refreshing: false,
      onRefresh: handleRefresh,
    });
  });

  it("no live gesture passes the real refresh state through (普通下拉照常刷新)", () => {
    expect(
      chatRefreshGateProps({ gestureLive: false, refreshing: true, onRefresh: handleRefresh }),
    ).toEqual({ refreshing: true, onRefresh: handleRefresh });
    expect(
      chatRefreshGateProps({ gestureLive: false, refreshing: false, onRefresh: handleRefresh }),
    ).toEqual({ refreshing: false, onRefresh: handleRefresh });
  });
});
