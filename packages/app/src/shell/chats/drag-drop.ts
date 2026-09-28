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
// intercepts a downward pull at the scroll top EVEN with scrollEnabled=false,
// and the official DraggableList wrapper only removes the control once the
// native drag has begun — too late. `chatRefreshGateProps` is the screen-side
// gate: while a row gesture is live (armed → menu → drag, exactly the
// `onGestureLockChange` band) the control is removed and `refreshing` forced
// false; a plain pull-down (never long-pressed, never armed) keeps it.
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
 * Ruling ③: the refresh gate. While a row gesture is live the pull-to-refresh
 * control must be GONE (not just idle): `refreshing=false` and `onRefresh`
 * dropped, which is what makes the official wrapper unmount the
 * RefreshControl (`showRefreshControl = Boolean(onRefresh) && …`). The gate
 * rides the same band as the scroll lock — armed at 180ms stationary, held
 * through menu/drag, released when the stream ends (press_out or the R2-01
 * drop handoff) — so 顶部向下拖 after a long press is a drag, and a plain
 * un-long-pressed pull-down still refreshes.
 */
export function chatRefreshGateProps<T extends () => void>(input: {
  gestureLive: boolean;
  refreshing: boolean;
  onRefresh: T;
}): { refreshing: boolean; onRefresh: T | undefined } {
  if (input.gestureLive) return { refreshing: false, onRefresh: undefined };
  return { refreshing: input.refreshing, onRefresh: input.onRefresh };
}
