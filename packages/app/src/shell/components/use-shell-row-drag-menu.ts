// Drag-vs-menu arbitration for chat rows (cards C3 + C20, DESIGN §14.4; KI-11).
//
// The decisions live in the pure state machine (`drag-menu-arbitration.ts`):
// drag arms at 180ms stationary, the menu window OPENS at a 250ms stationary
// hold (KI-16 halving; the machine module's constant note), movement before
// either decides between them — and once the window is open, moving the same
// finger past the relay slop (8px, measured-safe — see
// the machine module) dismisses the menu and hands the touch to the row drag,
// in one synchronous frame (the KI-11 ruling ② edge). See that module for the
// slop ladder and why 4 < 6 < 8.
//
// KI-11 ruling ① reversed the C20 actuator: the menu now appears AT the menu
// threshold with the finger still down, not on release. That is only possible
// because the mid-hold surface left the engine's Modal — showing a window-level
// Modal mid-gesture cancels the row's touch stream (C20 device finding, re-
// verified for the popover form in C33), which is what forced C20 to arm the
// window "pending" and materialise it on release. The surface is now the
// shell-hosted in-window popover (`ShellRowMenuHost`, chat-row-menu.tsx): the
// stream survives the open, so ruling ① (open mid-hold) and ruling ② (slide
// out of the visible menu into a drag, same gesture, no dead zone) coexist.
// `menuController` is that host's controller — `openMenu` at the machine's
// `open_menu` effect, `closeMenu` at `close_menu` (the relay's first beat,
// same synchronous pass as `drag()`).
//
// This hook is only the actuator: it owns the two timers, feeds anchor-relative
// deltas into the machine, and applies the machine's effects in order. Drag
// activation stays deferred to the moment the finger actually moves — the
// official hook calls DraggableFlatList's `drag()` from the arm timer itself;
// on a real draggable cell that activation ends the JS touch stream early
// (onPressOut never arrives) and the still-holding branch of the arbitration —
// the long-press menu on the row — dies with it. Verified on the MatePad.
// Movement-based drag start is also what react-native-draggable-flatlist
// documents for custom activators ("call drag() from your own long-press/move
// handler"), so deferring costs nothing.
//
// R2-01 (FIX-A): once drag() lifts the row, the JS stream ends without a
// usable release — a press_out may or may not arrive (B5-F15 device finding:
// RNGH's activation sends one mid-drag, which the machine now ignores), so the
// scroll lock (onGestureLockChange) must never depend on it.
// `drag()` hands the screen a release function (the onDragStart seam, same
// frame), the screen runs it from its onDragEnd handler, and the release drives
// the machine's `drag_end` edge — the phase machine stays the single source of
// truth; the screen never setState's the lock itself.
import { useCallback, useEffect, useRef } from "react";
import { type GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";
import {
  CONTEXT_MENU_DELAY_MS,
  DRAG_ARM_DELAY_MS,
  IDLE_ROW_GESTURE_STATE,
  stepRowGesture,
  type RowGestureState,
  type RowGestureStep,
} from "@/shell/components/drag-menu-arbitration";

/**
 * The shell-hosted row menu's controller (KI-11): `openMenu` shows the anchored
 * popover AT THE THRESHOLD, finger still down — the surface lives in the app
 * window, so the row's touch stream survives and the relay below stays live.
 * The anchor is in responder-space page coordinates (no status-bar shift: the
 * surface shares the list's window, unlike the engine's Modal). `closeMenu`
 * must retire only this row's request (the store's `closeFor`).
 */
export interface RowMenuController {
  openMenu: (anchor: { x: number; y: number }) => void;
  closeMenu: () => void;
}

function pointOf(event: GestureResponderEvent | null): { x: number; y: number } | null {
  const touch = event?.nativeEvent?.touches?.[0] ?? event?.nativeEvent;
  const x = touch?.pageX;
  const y = touch?.pageY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

export function useShellRowDragMenu(input: {
  drag: () => void;
  menuController: RowMenuController;
  /**
   * C20: fires exactly once per touch, in the same synchronous frame as
   * `drag()`. The list screen records the dragged row here so its drop handler
   * can tell 置顶组内换位 from 非置顶拖入置顶.
   * R2-01: the argument is this touch's out-of-band lock release — the drop
   * handler must run it (once) when the drag ends, because no press_out will.
   */
  onDragStart?: (releaseGestureLock: () => void) => void;
  /**
   * C20 device finding #2 (MatePad): the native ScrollView steals a vertical
   * drag at ~12-20px (RNGH pan CANCELLED before the hook's movement-based
   * drag() can land — even the pre-C20 C3 recipe loses this race on the
   * current build). The screen must freeze scrolling while a row gesture is
   * decided: this callback goes true when the touch arms (180ms stationary —
   * a real scroll never pauses first) and false when the stream ends. The
   * screen wires it to DraggableList's scrollEnabled.
   */
  onGestureLockChange?: (locked: boolean) => void;
}) {
  const { drag, menuController, onDragStart, onGestureLockChange } = input;
  const didLongPressRef = useRef(false);
  const gestureRef = useRef<RowGestureState>(IDLE_ROW_GESTURE_STATE);
  const gestureLockedRef = useRef(false);
  const lockCbRef = useRef(onGestureLockChange);
  // The unmount cleanup must reach the CURRENT controller without re-binding
  // its effect on every row render (KI-11: unmount retires this row's menu).
  const menuControllerRef = useRef(menuController);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    if (menuTimerRef.current) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    lockCbRef.current = onGestureLockChange;
    menuControllerRef.current = menuController;
  }, [menuController, onGestureLockChange]);

  useEffect(() => {
    return () => {
      clearTimers();
      // A cell unmounting mid-gesture (data churn) must not strand the list
      // with scrolling locked, nor leave a menu hosted for a row that is gone.
      // `closeMenu` is key-guarded by the row, so this never steals a newer
      // row's menu.
      menuControllerRef.current.closeMenu();
      if (gestureLockedRef.current) {
        gestureLockedRef.current = false;
        lockCbRef.current?.(false);
      }
    };
  }, [clearTimers]);

  const distanceFromStart = useCallback(() => {
    const start = touchStartRef.current;
    const current = touchCurrentRef.current ?? start;
    if (!start || !current) return Number.POSITIVE_INFINITY;
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  // Apply one machine step: store the state, mirror didLongPress for the row,
  // retire the timers once no timer outcome can still matter, then run the
  // effects in order. The relay step (close_menu → haptic_drag → start_drag)
  // is one synchronous pass — the window closes and the row lifts in the same
  // frame, which is the card's "同帧" requirement.
  const commit = useCallback(
    (step: RowGestureStep) => {
      gestureRef.current = step.state;
      didLongPressRef.current = step.state.didLongPress;
      const phase = step.state.phase;
      if (phase === "dragging" || phase === "list_owns" || phase === "idle") {
        clearTimers();
      }
      // Scroll lock: armed → locked (drag or menu — the decision band),
      // released when the touch stream ends (idle/list_owns) or — R2-01 — when
      // the list's drop handler runs the machine's drag_end edge.
      const locked = phase === "armed" || phase === "menu_open" || phase === "dragging";
      if (locked !== gestureLockedRef.current) {
        gestureLockedRef.current = locked;
        onGestureLockChange?.(locked);
      }
      for (const effect of step.effects) {
        switch (effect) {
          case "haptic_arm":
          case "haptic_menu":
            void Haptics.selectionAsync().catch(() => {});
            break;
          case "open_menu": {
            // KI-11 ruling ①: the window-hosted surface opens at the
            // threshold, anchored at the press point, finger still down.
            const anchor = touchStartRef.current;
            if (anchor) menuController.openMenu(anchor);
            break;
          }
          case "close_menu":
            menuController.closeMenu();
            break;
          case "haptic_drag":
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            break;
          case "start_drag":
            drag();
            onDragStart?.(releaseRef.current);
            break;
        }
      }
    },
    [clearTimers, drag, menuController, onDragStart, onGestureLockChange],
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      touchStartRef.current = pointOf(event);
      touchCurrentRef.current = touchStartRef.current;
      clearTimers();
      commit(stepRowGesture(gestureRef.current, { type: "press_in" }));

      armTimerRef.current = setTimeout(() => {
        commit(
          stepRowGesture(gestureRef.current, {
            type: "arm_tick",
            distance: distanceFromStart(),
          }),
        );
      }, DRAG_ARM_DELAY_MS);

      menuTimerRef.current = setTimeout(() => {
        commit(
          stepRowGesture(gestureRef.current, {
            type: "menu_tick",
            distance: distanceFromStart(),
          }),
        );
      }, CONTEXT_MENU_DELAY_MS);
    },
    [clearTimers, commit, distanceFromStart],
  );

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const phase = gestureRef.current.phase;
      // Terminal phases and the no-touch phase never re-decide. menu_open KEEPS
      // receiving moves — that is the KI-11 ruling ② relay input: sliding out
      // of the VISIBLE menu closes it and lifts the row in the same stream.
      if (phase === "idle" || phase === "dragging" || phase === "list_owns") return;
      const start = touchStartRef.current;
      const current = pointOf(event);
      if (!start || !current) return;
      touchCurrentRef.current = current;
      commit(
        stepRowGesture(gestureRef.current, {
          type: "touch_move",
          dx: current.x - start.x,
          dy: current.y - start.y,
        }),
      );
    },
    [commit],
  );

  const handlePressOut = useCallback(() => {
    // KI-11: nothing materialises on release anymore — the menu opened at the
    // threshold (or the relay already lifted the row). Release only ends the
    // stream; a menu that stayed open keeps staying open (backdrop / hardware
    // back / an item press own it from here).
    commit(stepRowGesture(gestureRef.current, { type: "press_out" }));
    touchStartRef.current = null;
    touchCurrentRef.current = null;
  }, [commit]);

  // R2-01: the out-of-band release handed to the screen at drag() time. It
  // only ever does what press_out would have done — run the machine (drag_end
  // is inert outside `dragging`, so double calls and stray drops are no-ops)
  // and forget the touch points.
  const releaseGestureLock = useCallback(() => {
    commit(stepRowGesture(gestureRef.current, { type: "drag_end" }));
    touchStartRef.current = null;
    touchCurrentRef.current = null;
  }, [commit]);
  releaseRef.current = releaseGestureLock;

  return { didLongPressRef, handlePressIn, handleTouchMove, handlePressOut };
}

/**
 * R2-01: the screen-side half of the out-of-band release. `handleRowDragStart`
 * records the dragged row's release (handed up in the same frame as drag()),
 * `handleDragEnd` runs it FIRST — before the search-mode early return — and
 * forgets it, so a re-fired drop or a drop without a recorded drag is inert.
 * The screen owns no lock state of its own beyond this handoff: the machine +
 * the hook's lock mirror stay the single truth.
 */
export function createDragLockHandoff(): {
  record(release: () => void): void;
  release(): void;
} {
  let current: (() => void) | null = null;
  return {
    record(release) {
      current = release;
    },
    release() {
      const fn = current;
      current = null;
      fn?.();
    },
  };
}
