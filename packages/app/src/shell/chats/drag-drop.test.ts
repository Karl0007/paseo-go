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
import { deriveChatSections, flattenChatSections } from "@/shell/chats/derive";
import {
  CHATS_LIST_CONTAINER_STYLE,
  chatGestureBandProps,
  decidePinDrop,
  dispatchPinDrop,
} from "@/shell/chats/drag-drop";
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

describe("chatGestureBandProps (ruling ③ + B4-REGRESS F10)", () => {
  const handleRefresh = () => {};
  const band = (gestureLive: boolean, refreshing = false) =>
    chatGestureBandProps({ gestureLive, refreshing, onRefresh: handleRefresh });

  it("keeps the refresh control MOUNTED and idle through a live gesture", () => {
    // F10 trigger ①: dropping `onRefresh` unmounts the wrapper's RefreshControl,
    // React moves the list's children out of it, every cell remounts, and each
    // row's unmount `closeFor` destroys the just-opened long-press menu ~400ms
    // later. The band may force `refreshing` false — it may never remove the hook.
    expect(band(true, true)).toEqual({
      scrollEnabled: false,
      refreshing: false,
      onRefresh: handleRefresh,
      containerStyle: CHATS_LIST_CONTAINER_STYLE,
      refreshEnabled: false,
    });
  });

  it("disables the control natively for the band, re-enables the moment it ends (B5-F15)", () => {
    // The R4-09 swallow only stops the RELOAD — Android still raised its spinner
    // mid-drag (evidence/B5-GESTURE/11-f15-midpull.png). `refreshEnabled` is the
    // VALUE-channel kill switch (SwipeRefreshLayout.setEnabled): OFF for the
    // whole armed → menu → drag band, ON outside it so the plain top pull-down
    // still refreshes.
    expect(band(true).refreshEnabled).toBe(false);
    expect(band(true, true).refreshEnabled).toBe(false);
    expect(band(false).refreshEnabled).toBe(true);
    expect(band(false, true).refreshEnabled).toBe(true);
  });

  it("hands the SAME flex:1 container object to both states (F10 trigger ②, R4-19)", () => {
    // The official wrapper's fallback is `scrollEnabled ? {flex:1} : undefined`, so
    // a band that rebuilds (or omits) the style collapses the list container to 0
    // the moment a row arms — VirtualizedList then unmounts every cell and the menu
    // dies the same way. Identity is the contract, not the value: same object.
    expect(band(true).containerStyle).toBe(band(false).containerStyle);
    expect(band(true).containerStyle).toEqual({ flex: 1 });
  });

  it("freezes scrolling only for the band; a plain pull keeps the real state", () => {
    expect(band(true).scrollEnabled).toBe(false);
    expect(band(false).scrollEnabled).toBe(true);
    expect(band(false, true).refreshing).toBe(true);
    expect(band(false, false).refreshing).toBe(false);
  });
});

// B5-PIN (F14 P1): the data-layer conservation contract. The device repro is
// 非置顶项长按→拖到顶（置顶成功）→取消置顶 → 该项从列表消失; whatever the render-layer
// mechanism turns out to be, the STORE + DERIVATION chain must never lose a row
// across any pin↔unpin sequence. This drives the exact production chain —
// derive → flatten → the library's drop splice (DraggableFlatList.onDragEnd's
// `splice(from,1); splice(to,0,data[from])`) → decidePinDrop → dispatchPinDrop
// against the REAL pins store and REAL actions → re-derive — and asserts after
// every step: the visible row-key set equals the directory set (no 删而未插),
// no duplicate FlatList keys, and pinnedIds stays duplicate-free.
describe("pin↔unpin round-trip set conservation (B5-PIN/F14 regression)", () => {
  interface Agent {
    key: string;
    serverId: string;
    lastActivityAt: number;
    attentionTimestamp: number | null;
    bucket: "done";
  }

  const AGENT_KEYS = ["s1:a1", "s1:a2", "s1:a3", "s1:a4", "s1:a5", "s1:a6"];
  const agents: Agent[] = AGENT_KEYS.map((key, i) => ({
    key,
    lastActivityAt: (i + 1) * 1000,
    serverId: "s1",
    attentionTimestamp: null,
    bucket: "done" as const,
  }));
  const deriveInput = () => ({
    agents,
    archivedIds: [],
    lastReadAt: {},
    hostIds: ["s1"],
    hostStatuses: new Map([["s1", "online" as const]]),
  });

  function visibleRows(): string[] {
    const sections = deriveChatSections({
      ...deriveInput(),
      pinnedIds: usePaseoGoPinsStore.getState().pinnedIds,
    });
    return flattenChatSections(sections)
      .filter((item) => item.type === "row")
      .map((item) => item.key);
  }

  function assertConserved(step: string) {
    const rows = visibleRows();
    // No duplicate keys: a collision makes React/VirtualizedList silently drop
    // one of the two cells — the classic "row vanished" renderer.
    expect(new Set(rows).size, step).toBe(rows.length);
    // Conservation: every directory agent is visible exactly once (all hosts
    // online, nothing archived) — nothing deleted-without-reinsert.
    expect(rows.map((key) => key.slice("row:".length)).sort(), step).toEqual(
      [...AGENT_KEYS].sort(),
    );
    const pins = usePaseoGoPinsStore.getState().pinnedIds;
    expect(new Set(pins).size, step).toBe(pins.length);
  }

  /** One library drop: splice the flat item from `from` to `to` exactly like
   *  DraggableFlatList.onDragEnd does, then run the screen's handler pipeline. */
  function dragDrop(droppedKey: string | null, to: number) {
    const sections = deriveChatSections({
      ...deriveInput(),
      pinnedIds: usePaseoGoPinsStore.getState().pinnedIds,
    });
    const data = flattenChatSections(sections);
    const from = data.findIndex((item) => item.key === `row:${droppedKey}`);
    expect(from, `drag start row present: ${droppedKey}`).toBeGreaterThanOrEqual(0);
    const newData = [...data];
    const [moved] = newData.splice(from, 1);
    newData.splice(Math.min(to, newData.length), 0, moved!);
    const visibleRowKeys: string[] = [];
    for (const item of newData) {
      if (item.type === "row") visibleRowKeys.push(item.row.agent.key);
    }
    const { actions } = realActionsRef;
    const decision = decidePinDrop({
      droppedKey,
      visibleRowKeys,
      pinnedIds: usePaseoGoPinsStore.getState().pinnedIds,
    });
    dispatchPinDrop(decision, { actions, targetOf: targetOfKey });
    return decision;
  }

  const realActionsRef = (() => {
    const deps = {
      t: (key: string) => key,
      notify: vi.fn(),
      reportError: vi.fn(),
      getClient: vi.fn(() => null),
      confirm: vi.fn(async () => true),
      haptic: vi.fn(),
    };
    return { actions: createShellAgentActions(deps) };
  })();

  it("the card's exact repro: drag a row to the top (pins), menu-unpin, drag-out unpin — row set never changes", () => {
    assertConserved("initial");

    // 最旧的 非置顶项 s1:a1 拖到顶 → pin-at 0 → 置顶成功。
    expect(dragDrop("s1:a1", 0)).toEqual({ kind: "pin-at", key: "s1:a1", index: 0 });
    expect(usePaseoGoPinsStore.getState().pinnedIds).toContain("s1:a1");
    assertConserved("after drag-pin");

    // 取消置顶（菜单）→ 行必须回到 最近，绝不消失。
    usePaseoGoPinsStore.getState().togglePin("s1:a1", false);
    assertConserved("after menu-unpin");

    // 再来一轮：置顶 → 拖出置顶组取消 → 守恒。
    usePaseoGoPinsStore.getState().togglePin("s1:a1", true);
    assertConserved("after menu-pin");
    expect(dragDrop("s1:a1", 4).kind).toBe("unpin");
    expect(usePaseoGoPinsStore.getState().pinnedIds).not.toContain("s1:a1");
    assertConserved("after drag-unpin");
  });

  it("any seeded pin/unpin sequence (drag + menu, 300 steps) conserves the row set", () => {
    let seed = 0x2f6e2b1;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    for (let step = 0; step < 300; step += 1) {
      const pick = AGENT_KEYS[rand(AGENT_KEYS.length)]!;
      const roll = rand(4);
      if (roll === 0) {
        usePaseoGoPinsStore.getState().togglePin(pick, true);
      } else if (roll === 1) {
        usePaseoGoPinsStore.getState().togglePin(pick, false);
      } else {
        const rows = visibleRows();
        const to = rand(rows.length);
        dragDrop(pick, to);
      }
      assertConserved(`seeded step ${step} (roll=${roll} pick=${pick})`);
    }
  });
});
