// B8-SWIPE (F27) — the actuator of 堆叠页全宽右滑返回: the C21 edge-back Pan with
// its start-x band gate REMOVED (the band stays only on the official session
// screen, `use-shell-edge-back-gesture`; 卡片口径: 挂不住的上游滚动体由左缘带兜底).
// Same proven topology — the Pan rides an ANCESTOR View of every screen it
// governs (卡 09 重拍 + 卡 14 复量：Portal 的 box-none 兄弟层一次也没拿到触摸流，
// 手势面必须是滚动体的祖先) — and the same pure direction lock
// (`resolveShellEdgeSwipeIntent` via `decideShellSwipe`): rightward ≥ 24dp with
// horizontal dominance pops, leftward FAILS (堆叠页上左滑不切 tab), vertical goes
// to the scroll views.
//
// Gates: `enabled` (frontmost-is-(detail) — the overlay's layout sibling cannot
// see the stack itself), `blocked` (声明性豁免 bus: 搜索态/打开的 sheet), and the
// HorizontalScrollContext posture (diff 代码块 scrolled off its leading edge keeps
// its own rightward swipe — the same check the capsule band and the official open
// gesture make).
import { useCallback, useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { decideShellSwipe } from "./swipe-machine";

export function useShellStackBackGesture(input: {
  /** 栈顶是 (detail) 组时才有返回可切（(shell)/官方屏在前=让位）。 */
  enabled: boolean;
  /** 本屏声明的豁免（搜索态/sheet 打开）。 */
  blocked: boolean;
  /** 返回动词：detailBack（pop，深链无底则 replace 兜底）。 */
  onBack: () => void;
}) {
  const { enabled, blocked, onBack } = input;
  const horizontalScroll = useHorizontalScrollOptional();
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const requestBack = useCallback(() => onBack(), [onBack]);

  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
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
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }
          const decision = decideShellSwipe(
            // 全宽：无 start-x 门；absoluteX/Y 是 dp（RNGH 原生事件已换算，与
            // 边缘带 band 门同一单位系），行程从按下点起算。
            {
              deltaX: touch.absoluteX - touchStartX.value,
              deltaY: touch.absoluteY - touchStartY.value,
            },
            {
              stackInFront: true,
              blocked,
              horizontalScrolled:
                horizontalScroll?.isAnyScrolledRight.value === true ||
                horizontalScroll?.activeGestureStartedScrolled.value === true,
            },
          );
          if (decision.intent === "back") stateManager.activate();
          else if (decision.intent === "fail") stateManager.fail();
        })
        .onEnd((_event, success) => {
          if (success) scheduleOnRN(requestBack);
        }),
    [blocked, enabled, horizontalScroll, requestBack, touchStartX, touchStartY],
  );
}
