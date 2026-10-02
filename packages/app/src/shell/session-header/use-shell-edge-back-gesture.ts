// C21 shell edge-back gesture: the transparent left-edge right-swipe the shell
// carries while the session capsule is visible. Since REVIEW-B8-14 the Pan
// attaches to `ShellSessionEdgeBackHost` — an ANCESTOR View of the official
// session screen (mounted by the tablet split host) — NOT to the capsule's
// `box-none` Portal layer: that layer is a navigator sibling and its band
// anchor is pointerEvents="none", so only touches hitting the bar entered its
// handler chain (device verdict 2026-10-02: bar-start pops, mid-screen starts
// dead). The host's own View is touchable on Android by design — exactly like
// the official open gesture's wrapper (MobileGestureWrapper) it sits ABOVE the
// navigator, so the touch stream reaches this Pan while the session's own views
// still receive the touch (taps focus, vertical drags scroll: manual
// activation only steals the stream once the direction lock commits). The
// ≈32dp edge is the start-x gate below, mirroring the official open gesture's
// edge check. Activation goes through the pure direction lock (`edge-swipe`),
// so only a rightward drag of SHELL_EDGE_BACK_ACTIVATE_DP with horizontal
// dominance steals the touch from the session and pops the official screen back
// onto the shell list — the same verb as the capsule's 返回 button and the
// system back.
//
// The official left-open/right-open gestures are parked separately, via the
// provider's symbol-keyed blocker (useBlockMobilePanelOpenGestures in the
// capsule); this hook only owns the swipe itself. The horizontal-scroll guard
// mirrors the official open gesture: a code block scrolled off its leading
// edge keeps its own rightward swipe.
import { useCallback, useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { detailBack } from "@/shell/detail-back";
import { SHELL } from "@/shell/routes";
import { scheduleOnRN } from "react-native-worklets";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { isInsideShellEdgeBand, resolveShellEdgeSwipeIntent } from "./edge-swipe";

export function useShellEdgeBackGesture(enabled: boolean) {
  const horizontalScroll = useHorizontalScrollOptional();
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const requestBack = useCallback(() => {
    // KI-17③: same verb as the capsule's 返回 key — pops onto the shell list;
    // on a headless cold deep-link stack (nothing beneath to pop) it replaces
    // onto (shell)/chats instead of swallowing the swipe.
    detailBack(SHELL.chats);
  }, []);

  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (touch) {
            touchStartX.value = touch.absoluteX;
            touchStartY.value = touch.absoluteY;
          }
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (
            !touch ||
            event.numberOfTouches !== 1 ||
            // Band gate: dp against dp — RNGH's absoluteX is already density-free.
            !isInsideShellEdgeBand(touchStartX.value) ||
            horizontalScroll?.isAnyScrolledRight.value ||
            horizontalScroll?.activeGestureStartedScrolled.value
          ) {
            stateManager.fail();
            return;
          }
          const decision = resolveShellEdgeSwipeIntent({
            deltaX: touch.absoluteX - touchStartX.value,
            deltaY: touch.absoluteY - touchStartY.value,
          });
          if (decision === "back") stateManager.activate();
          else if (decision === "fail") stateManager.fail();
        })
        .onEnd((_event, success) => {
          if (success) scheduleOnRN(requestBack);
        }),
    [enabled, horizontalScroll, requestBack, touchStartX, touchStartY],
  );
}
