// Drag-vs-menu arbitration for chat rows (cards C3 + C20, DESIGN §14.4).
//
// The decisions live in the pure state machine (`drag-menu-arbitration.ts`):
// drag arms at 180ms stationary, the menu-window decision lands on a 500ms
// stationary hold, movement before either decides between them — and once the
// window decision is made, moving the same finger past the relay slop (8px,
// measured-safe — see the machine module) dismisses the window and hands the
// touch to the drag, in one synchronous frame (the C20 edge). See that module
// for the slop ladder and why 4 < 6 < 8.
//
// C20 device finding (MatePad, sheet form): the engine's menu surfaces live in
// a native Modal — SHOWING one mid-gesture CANCELS the row's touch stream (no
// onTouchMove ever reaches the row again; verified with burst screencaps: the
// sheet stayed open through 250px of continued movement, no relay, no drag).
// The hook-side minimum adjustment: the 500ms decision only ARMS a pending
// window (open_menu below); it appears on release at the same anchor
// (handlePressOut). Decision timing, anchor and the relay threshold follow the
// ruling's shape — and a slide past it now dismisses the pending window and
// drags in the SAME stream, which is the ruling's observable outcome.
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
import { useCallback, useEffect, useRef } from "react";
import { Platform, StatusBar, type GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";
import {
  CONTEXT_MENU_DELAY_MS,
  DRAG_ARM_DELAY_MS,
  IDLE_ROW_GESTURE_STATE,
  stepRowGesture,
  type RowGestureState,
  type RowGestureStep,
} from "@/shell/components/drag-menu-arbitration";
import type { MenuContextValue } from "@/components/ui/menu";

function pointOf(event: GestureResponderEvent | null): { x: number; y: number } | null {
  const touch = event?.nativeEvent?.touches?.[0] ?? event?.nativeEvent;
  const x = touch?.pageX;
  const y = touch?.pageY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

export function useShellRowDragMenu(input: {
  drag: () => void;
  menuController: MenuContextValue;
  /**
   * C20: fires exactly once per touch, in the same synchronous frame as
   * `drag()`. The list screen records the dragged row here so its drop handler
   * can tell 置顶组内换位 from 非置顶拖入置顶.
   */
  onDragStart?: () => void;
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
  // C20: the 500ms window decision, awaiting release to become visible (the
  // Modal stream-cancel finding — see the header).
  const pendingMenuRef = useRef(false);
  const gestureLockedRef = useRef(false);
  const lockCbRef = useRef(onGestureLockChange);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [onGestureLockChange]);

  useEffect(() => {
    return () => {
      clearTimers();
      // A cell unmounting mid-gesture (data churn) must not strand the list
      // with scrolling locked.
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
      // Scroll lock: armed → locked (drag or window, the decision is pending),
      // released the moment the touch stream ends (idle) or the list took it.
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
          case "open_menu":
            pendingMenuRef.current = true;
            break;
          case "close_menu":
            pendingMenuRef.current = false;
            menuController.setOpen(false);
            break;
          case "haptic_drag":
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            break;
          case "start_drag":
            drag();
            onDragStart?.();
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
      pendingMenuRef.current = false;
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
      // receiving moves — that is the C20 relay input (the pre-C20 code
      // returned here, which made a live window a dead zone).
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
    const start = touchStartRef.current;
    const openPending = pendingMenuRef.current;
    pendingMenuRef.current = false;
    commit(stepRowGesture(gestureRef.current, { type: "press_out" }));
    touchStartRef.current = null;
    touchCurrentRef.current = null;
    if (openPending && start) {
      const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
      menuController.setAnchorRect({
        x: start.x,
        y: start.y + statusBarHeight,
        width: 0,
        height: 0,
      });
      menuController.setOpen(true);
    }
  }, [commit, menuController]);

  return { didLongPressRef, handlePressIn, handleTouchMove, handlePressOut };
}
