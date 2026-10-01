// KI-11 ruling ③+④: the pure drop/refresh semantics behind the 对话 list.
//
// Ruling ④ (置顶一致性) — the investigated fork and its unified model:
//
//   BEFORE (C20): the menu's pin/unpin button went through ShellAgentActions
//   .pin/.unpin → `pins.togglePin` (+ haptic + toast); the drag drop went
//   through `pins.pinAt` directly with an INLINE haptic + toast copy, and a
//   pinned row dragged OUT of the 置顶 group persisted nothing (its relative
//   order among the remaining pinned rows was unchanged, so `reorderPinned`
//   was a no-op and the row snapped back). Three divergences: different store
//   action, duplicated side effects, and drag-out ≠ unpin.
//
//   AFTER: a drop is classified against the zone boundary (置顶 group vs the
//   rest of the visible list) by `decidePinDrop`, and `dispatchPinDrop` runs
//   the decision through the SAME action-layer calls the menu buttons make —
//   cross-zone in = `actions.pin(target, index)`, cross-zone out =
//   `actions.unpin(target)`, in-group = `actions.reorderPinned` (pure order,
//   no pin-state change), unpinned-zone move = nothing (those rows are
//   time-derived; there is no order to persist). Single truth, zero forks.
//
// Ruling ③ (双向拖动不误触刷新): Android's SwipeRefreshLayout (RN RefreshControl)
// intercepts a downward pull at the scroll top EVEN with scrollEnabled=false —
// `ReactSwipeRefreshLayout.onInterceptTouchEvent` only asks `canChildScrollUp()`
// (C20 device finding, re-read against RN source in the R4-09 复核). B5-NOREFRESH
// (F15) closes the ruling's last holes: the control now goes NATIVELY DISABLED
// (`enabled=false`, a value — never an unmount, the F10 lesson) for the whole
// armed → menu → drag band, so it neither intercepts the pull nor shows its
// spinner, and the wrapper's old drag-time unmount (which remounted every cell
// mid-drag and killed the band it was guarding — the F14/F15 shared root cause,
// evidence/B5-GESTURE) is gone. The screen's callback swallow stays as the
// second line of defense. A plain pull-down refreshes as usual.
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";

/**
 * What a finished drop means for the pin store, decided from the flat order.
 *
 * The zone test is the group boundary in the flat list: a row is inside the
 * 置顶 group iff no UNPINNED visible row sits above it. That reads correctly
 * for both directions:
 * - pinned row dragged below the group → an unpinned row is above it → unpin;
 * - unpinned row dragged into the group → only pinned rows above it → pin at
 *   the count of those pinned rows (the group-relative slot);
 * - unpinned row moved within/below the unpinned zone → an unpinned row stays
 *   above it → nothing to persist (time-derived order re-asserts itself).
 *
 * `droppedKey === null` (a drop without a recorded drag-start — the C3 belt)
 * falls back to the in-group reorder of whatever pinned rows are visible.
 */
export type PinDropDecision =
  /** Unpinned row dropped INSIDE the 置顶 group: pin at this group slot. */
  | { kind: "pin-at"; key: string; index: number }
  /** Pinned row dropped OUTSIDE the group (an unpinned row sits above it): unpin. */
  | { kind: "unpin"; key: string }
  /** Pinned row re-ordered within the group: persist the new relative order. */
  | { kind: "reorder"; orderedPinnedKeys: string[] }
  /** Unpinned row moved within the time-derived zone: nothing to persist. */
  | { kind: "none" };

export function decidePinDrop(input: {
  droppedKey: string | null;
  visibleRowKeys: readonly string[];
  pinnedIds: readonly string[];
}): PinDropDecision {
  const pinned = new Set(input.pinnedIds);
  const { droppedKey, visibleRowKeys } = input;

  let pinnedAbove = 0;
  let unpinnedAbove = 0;
  for (const key of visibleRowKeys) {
    if (key === droppedKey) break;
    if (pinned.has(key)) pinnedAbove += 1;
    else unpinnedAbove += 1;
  }

  if (droppedKey === null) {
    return {
      kind: "reorder",
      orderedPinnedKeys: visibleRowKeys.filter((key) => pinned.has(key)),
    };
  }

  if (pinned.has(droppedKey)) {
    if (unpinnedAbove > 0) return { kind: "unpin", key: droppedKey };
    return {
      kind: "reorder",
      orderedPinnedKeys: visibleRowKeys.filter((key) => pinned.has(key)),
    };
  }

  // Unpinned drop: inside the group only while nothing unpinned sits above it.
  // Below/between unpinned rows the list re-derives by time — persisting the
  // visible order would be a lie (and an empty reorder would wipe the group).
  if (unpinnedAbove > 0) return { kind: "none" };
  return { kind: "pin-at", key: droppedKey, index: pinnedAbove };
}

/**
 * Run a decision through the action layer — the SAME `pin`/`unpin`/
 * `reorderPinned` calls the menu buttons make, so haptics, toasts and store
 * writes stay single-sourced (`targetOf` resolves the flat key back to the
 * row's action target; a vanished row dispatches nothing).
 */
export function dispatchPinDrop(
  decision: PinDropDecision,
  deps: {
    actions: Pick<ShellAgentActions, "pin" | "unpin" | "reorderPinned">;
    targetOf: (key: string) => ShellChatTarget | null;
  },
): void {
  switch (decision.kind) {
    case "pin-at": {
      const target = deps.targetOf(decision.key);
      if (target) deps.actions.pin(target, decision.index);
      return;
    }
    case "unpin": {
      const target = deps.targetOf(decision.key);
      if (target) deps.actions.unpin(target);
      return;
    }
    case "reorder":
      deps.actions.reorderPinned(decision.orderedPinnedKeys);
      return;
    case "none":
      return;
  }
}

/**
 * KI-11 ruling ③ + B4-REGRESS F10: the props the row-gesture band is allowed to
 * hand the list, in one pure function so the whole keep-mounted contract is
 * testable (drag-drop.test.ts).
 *
 * F10 had TWO remount triggers and both are SHAPE changes:
 *  1. `onRefresh` UNDEFINED → the official wrapper drops the `<RefreshControl>`
 *     element, React moves the list's children out of it, every cell remounts, and
 *     each row's unmount `closeFor` destroys the just-opened long-press menu
 *     ~400ms later (B4-REGRESS F10, fixed by 6ec69b112).
 *  2. `containerStyle` ABSENT → the wrapper falls back to
 *     `scrollEnabled ? {flex:1} : undefined`, so the band's own
 *     `scrollEnabled={false}` collapses the container to 0, VirtualizedList
 *     unmounts every cell, same cleanup, same vanished menu.
 * The lesson twice: the band may change VALUES, never the SHAPE. Hence
 * `containerStyle` is the module constant below — the same object in both states,
 * asserted by test (R4-19).
 *
 * Ruling ③ (双向拖动不误触刷新) then needs a suppression that does not touch the
 * shape. C20's device finding stands, and RN's source says why:
 * `ReactSwipeRefreshLayout.onInterceptTouchEvent` asks `canChildScrollUp()` and
 * never consults the ScrollView's `scrollEnabled` — at the scroll top a downward
 * pull IS intercepted even with scrolling locked.
 *
 * B5-NOREFRESH (F15) closed the two remaining holes in the R4-09 answer
 * ("swallow the callback in handleRefresh"): (a) swallowing suppresses the
 * RELOAD but never the native GESTURE — the SwipeRefreshLayout spinner still
 * rode the pull (evidence/B5-GESTURE/11-f15-midpull.png); (b) the wrapper's
 * old drag-time RefreshControl UNMOUNT remounted every cell at drag(), whose
 * unmount cleanup released the band — `gestureLiveRef` read false for the
 * rest of the very drag it was guarding (ReactNativeJS log: press_out 2-3ms
 * after start_drag; a later release then went REFRESH-ALL). The lever that
 * kills gesture AND spinner without a shape change is Android's
 * `SwipeRefreshLayout.setEnabled(false)` — RN exposes it as the RefreshControl
 * `enabled` prop. Hence `refreshEnabled: !gestureLive` below: OFF for the
 * whole armed → menu → drag band (the control neither intercepts nor spins),
 * ON the moment the band ends so a plain pull-down refreshes as usual. The
 * handleRefresh swallow stays as the second line of defense (iOS ignores
 * `enabled`; and a pull faster than the prop's commit can still start the
 * native gesture before the disable lands — its callback is then swallowed).
 */
export const CHATS_LIST_CONTAINER_STYLE: { flex: 1 } = { flex: 1 };

export function chatGestureBandProps<T extends () => void>(input: {
  gestureLive: boolean;
  refreshing: boolean;
  onRefresh: T;
}): {
  scrollEnabled: boolean;
  refreshing: boolean;
  onRefresh: T;
  containerStyle: { flex: 1 };
  refreshEnabled: boolean;
} {
  return {
    // C20 device finding #2: the native ScrollView steals a vertical drag at
    // ~12-20px, before the movement-based drag() can lift the row — the band
    // freezes scrolling so the row, not the list, owns the stream.
    scrollEnabled: !input.gestureLive,
    // The spinner is the screen's, not the gesture's: a stale `refreshing=true`
    // bleeding into the band would pin the control on-screen mid-drag.
    refreshing: input.gestureLive ? false : input.refreshing,
    // DEFINED in both states — presence is the remount surface (trigger ① above).
    onRefresh: input.onRefresh,
    containerStyle: CHATS_LIST_CONTAINER_STYLE,
    // B5-F15: Android `RefreshControl enabled` — VALUE, not shape. The control
    // stays mounted the whole band; it just cannot intercept or spin.
    refreshEnabled: !input.gestureLive,
  };
}
