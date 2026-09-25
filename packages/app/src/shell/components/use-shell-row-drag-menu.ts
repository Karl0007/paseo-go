// Drag-vs-menu arbitration for pinned chat rows (card C3).
//
// Same timing contract as the official sidebar hook (drag arms at 180ms stationary,
// the sheet menu opens on a stationary hold, movement decides between them) and the
// same pure decision function — but the drag activation is deferred to the moment
// the finger actually moves. The official hook calls DraggableFlatList's `drag()`
// from the arm timer itself; on a real draggable cell that activation ends the JS
// touch stream early (onPressOut never arrives) and the still-holding branch of the
// arbitration — the long-press menu on a pinned row — dies with it. Verified on the
// MatePad: menu never opened for a pinned row through the upstream hook.
//
// Movement-based drag start is also what react-native-draggable-flatlist documents
// for custom activators ("call drag() from your own long-press/move handler"), so
// deferring costs nothing: by the time drag() runs the pan is already past the
// list's 20px activation distance.
import { useCallback, useEffect, useRef } from "react";
import { Platform, StatusBar, type GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { decideLongPressMove } from "@/utils/sidebar-gesture-arbitration";
import type { useContextMenu } from "@/components/ui/context-menu";

const DRAG_ARM_DELAY_MS = 180;
const DRAG_ARM_STATIONARY_SLOP_PX = 4;
// Matches the engine's own native long-press delay (Pressable default 500ms, what
// unpinned rows use), so both row kinds tickle at the same perceived delay — and a
// finger that meant to drag has cleared the menu slop before this fires.
const CONTEXT_MENU_DELAY_MS = 500;
const CONTEXT_MENU_STATIONARY_SLOP_PX = 6;

function pointOf(event: GestureResponderEvent | null): { x: number; y: number } | null {
  const touch = event?.nativeEvent?.touches?.[0] ?? event?.nativeEvent;
  const x = touch?.pageX;
  const y = touch?.pageY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

export function useShellRowDragMenu(input: {
  drag: () => void;
  menuController: ReturnType<typeof useContextMenu>;
}) {
  const { drag, menuController } = input;
  const didLongPressRef = useRef(false);
  const dragArmedRef = useRef(false);
  const didStartDragRef = useRef(false);
  const menuOpenedRef = useRef(false);
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

  useEffect(() => clearTimers, [clearTimers]);

  const distanceFromStart = useCallback(() => {
    const start = touchStartRef.current;
    const current = touchCurrentRef.current ?? start;
    if (!start || !current) return Number.POSITIVE_INFINITY;
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      didLongPressRef.current = false;
      dragArmedRef.current = false;
      didStartDragRef.current = false;
      menuOpenedRef.current = false;
      touchStartRef.current = pointOf(event);
      touchCurrentRef.current = touchStartRef.current;
      clearTimers();

      armTimerRef.current = setTimeout(() => {
        if (didStartDragRef.current || menuOpenedRef.current) return;
        if (distanceFromStart() > DRAG_ARM_STATIONARY_SLOP_PX) return;
        dragArmedRef.current = true;
        void Haptics.selectionAsync().catch(() => {});
      }, DRAG_ARM_DELAY_MS);

      menuTimerRef.current = setTimeout(() => {
        if (didStartDragRef.current || menuOpenedRef.current) return;
        if (distanceFromStart() > CONTEXT_MENU_STATIONARY_SLOP_PX) return;
        const start = touchStartRef.current;
        if (!start) return;
        const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
        menuController.setAnchorRect({
          x: start.x,
          y: start.y + statusBarHeight,
          width: 0,
          height: 0,
        });
        menuController.setOpen(true);
        menuOpenedRef.current = true;
        didLongPressRef.current = true;
        void Haptics.selectionAsync().catch(() => {});
      }, CONTEXT_MENU_DELAY_MS);
    },
    [clearTimers, distanceFromStart, menuController],
  );

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const start = touchStartRef.current;
      const current = pointOf(event);
      if (!start || !current || didStartDragRef.current || menuOpenedRef.current) return;
      touchCurrentRef.current = current;
      const decision = decideLongPressMove({
        dragArmed: dragArmedRef.current,
        didStartDrag: didStartDragRef.current,
        startPoint: start,
        currentPoint: current,
      });
      if (
        decision === "cancel_long_press" ||
        decision === "vertical_scroll" ||
        decision === "horizontal_swipe"
      ) {
        // Movement before the arm: the list (or a swipe) owns the gesture, and no
        // menu may follow this touch.
        didLongPressRef.current = decision !== "cancel_long_press";
        clearTimers();
        return;
      }
      if (decision === "start_drag") {
        didStartDragRef.current = true;
        didLongPressRef.current = true;
        clearTimers();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        drag();
      }
    },
    [clearTimers, drag],
  );

  const handlePressOut = useCallback(() => {
    clearTimers();
    dragArmedRef.current = false;
    touchStartRef.current = null;
    touchCurrentRef.current = null;
  }, [clearTimers]);

  return { didLongPressRef, handlePressIn, handleTouchMove, handlePressOut };
}
