// C21 shell edge-back gesture: the transparent left-edge right-swipe the
// capsule carries while it is visible. The Pan attaches to the capsule's
// full-screen `box-none` Portal layer, NOT to a band View: a GestureDetector's
// own view is touchable on Android, so a 32dp band would steal every tap and
// vertical drag inside its column from the session underneath (measured
// on-device — the composer's left edge stopped focusing). A `box-none` host is
// skipped by RN's hit-test, so touches keep landing on the session's own views
// (taps focus, vertical drags scroll), while RNGH's root observer still feeds
// the stream to this Pan; the 32dp edge is enforced by the start-x gate below,
// mirroring the official open gesture's edge check. Activation goes through the
// pure direction lock (`edge-swipe`), so only a rightward drag of
// SHELL_EDGE_BACK_ACTIVATE_DP with horizontal dominance steals the touch from
// the session and pops the official screen back onto the shell list — the same
// verb as the capsule's 返回 button and the system back.
//
// The official left-open/right-open gestures are parked separately, via the
// provider's symbol-keyed blocker (useBlockMobilePanelOpenGestures in the
// capsule); this hook only owns the swipe itself. The horizontal-scroll guard
// mirrors the official open gesture: a code block scrolled off its leading
// edge keeps its own rightward swipe.
import { useCallback, useMemo } from "react";
import { PixelRatio } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { router } from "expo-router";
import { scheduleOnRN } from "react-native-worklets";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { resolveShellEdgeSwipeIntent, SHELL_EDGE_BAND_WIDTH_DP } from "./edge-swipe";

export function useShellEdgeBackGesture(enabled: boolean) {
  const horizontalScroll = useHorizontalScrollOptional();
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const requestBack = useCallback(() => {
    router.back();
  }, []);

  // The layer spans the window, so the card's ≈32dp band is a start-x limit.
  const edgeLimitPx = SHELL_EDGE_BAND_WIDTH_DP * PixelRatio.get();

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
            touchStartX.value > edgeLimitPx ||
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
    [edgeLimitPx, enabled, horizontalScroll, requestBack, touchStartX, touchStartY],
  );
}
