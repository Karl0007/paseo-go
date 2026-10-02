// B8-FILESWIP (F29) — the actuator half of the 文件页三段屏内横滑: a Reanimated
// horizontal Pan over the files body's panel column that moves the LINEAR
// segment machine (`files-segment.ts`) through the SAME arbiter as the ring and
// the stack-back (`decideShellSwipe`, role "files-segment"). 单仲裁器原则: this
// is not a second state machine — it is the frontmost consumer of the one
// arbiter, and the 级联 is structural: at a boundary this pan FAILS, and RNGH
// releases the SAME touch stream to the ancestor pan covering the screen
// (栈页 = ShellStackBackHost 的全宽右滑返回；未来 tab 宿主 = 主环 Pan). When it
// ACTIVATES, the orchestrator's makeActive cancels those ancestors — 两段切换
// 永远不会同时弹栈页.
//
// Topology = the two on-device-proven parent-pan hosts (ring / stack-back): the
// Pan sits on an ANCESTOR of the panels' scrollables, activates manually from
// the pure direction lock, and drives one shared value that becomes a
// translateX. Gates are shared values the worklet reads — `blocked`/posture
// never rebuild the gesture and never re-render the panes (B4-REGRESS 重挂面).
//
// The commit lands through the SCREEN's own setter (`handleTabChange`), so the
// two beats are fully in-screen: 出场拍 parks the surface at its wall, the
// setter flips `activeTab`, the index-prop beat plays 进场 from the opposite
// wall (the ring's localTargetRef idiom, minus the cross-tab bus — there is no
// navigation here). A mid-beat segment-row tap interrupts the exit timing
// (withTiming callback: finished=false) — the land never stomps the user.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { isCompactWindowWidth, tabletColumnsForWidth } from "@/shell/tablet/form-factor";
import { decideShellSwipe } from "./swipe-machine";
import { decideFilesSegmentRelease, type FilesSegmentDirection } from "./files-segment";
import { clampRingSwipeTranslation, ringEntryEdge } from "./tab-ring";

/** 出场/进场/回弹三拍时长（ms）——环同款参数组（F29 口径：同参数组，一处真源）。 */
const EXIT_MS = 140;
const ENTER_MS = 180;
const SNAP_BACK_MS = 180;

export function useFilesSegmentSwipe(input: {
  /** 当前段序号（activeTab 投影；非 git 时被 constrain 到 0）。 */
  index: number;
  /** 可滑段数：git checkout=3；非 git 灰两段=1（无内滑只剩外抛）。 */
  count: number;
  /** 本屏的互斥带：页内搜索态（换页动画旗由 hook 自持）。 */
  blocked: boolean;
  /** 换段落地：屏自己的 setter（与页签行同一状态机）。 */
  onSwitchSegment: (target: number) => void;
}) {
  const { index, count, blocked, onSwitchSegment } = input;

  // 列宽：首帧种子用窗口形态学（本面在详情列/整窗，不是环的列表列——宽屏扣掉
  // rail+list），onLayout 实测接管。
  const { width: windowWidthDp } = useWindowDimensions();
  const seedWidthDp = (() => {
    if (isCompactWindowWidth(windowWidthDp)) return windowWidthDp;
    const cols = tabletColumnsForWidth(windowWidthDp);
    return Math.max(windowWidthDp - cols.rail - cols.list, 1);
  })();
  const [measuredWidthDp, setMeasuredWidthDp] = useState<number | null>(null);
  const widthDp = measuredWidthDp ?? seedWidthDp;

  const tx = useSharedValue(0);
  const indexSv = useSharedValue(index);
  const countSv = useSharedValue(count);
  const widthSv = useSharedValue(widthDp);
  const blockedSv = useSharedValue(blocked);
  /** 换段两拍进行中：期间不吃新手势（否则中途改目标段=两拍错乱）。 */
  const turningSv = useSharedValue(false);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const switchSegmentRef = useRef(onSwitchSegment);
  useEffect(() => {
    switchSegmentRef.current = onSwitchSegment;
  }, [onSwitchSegment]);
  useEffect(() => {
    widthSv.value = widthDp;
  }, [widthDp, widthSv]);
  useEffect(() => {
    blockedSv.value = blocked;
  }, [blocked, blockedSv]);
  // checkout 状态在两拍之间翻脸（git→非 git）：posture 立即跟上，新手势只剩外抛。
  useEffect(() => {
    countSv.value = count;
  }, [count, countSv]);

  /** 本次换段的方向（进场从哪面墙）+ 内目标（index prop 变化拍消费）。 */
  const directionRef = useRef<FilesSegmentDirection>("forward");
  const localTargetRef = useRef<number | null>(null);

  const playEntry = useCallback(
    (direction: FilesSegmentDirection) => {
      // 先瞬移到对侧墙外（与新段数据同一批 UI 线程写入），再吸附进场。
      tx.value = ringEntryEdge(direction, widthSv.value);
      tx.value = withTiming(0, { duration: ENTER_MS }, () => {
        turningSv.value = false;
      });
    },
    [tx, widthSv, turningSv],
  );

  // index 投影变化 = 换段的进场拍（本屏 setter 落地后）；两拍途中用户点了页签行
  // （换到手势目标以外的段）：打断出场拍、不做进场，归位即可。
  useEffect(() => {
    indexSv.value = index;
    const local = localTargetRef.current;
    if (local === null) return;
    localTargetRef.current = null;
    if (local !== index) {
      tx.value = withTiming(0, { duration: SNAP_BACK_MS });
      turningSv.value = false;
      return;
    }
    playEntry(directionRef.current);
  }, [index, indexSv, tx, turningSv, playEntry]);

  /** 出场拍结束→落地：本屏 setter（页签行的同款状态机，visited 记账在屏侧）。 */
  const land = useCallback((target: number, direction: FilesSegmentDirection) => {
    localTargetRef.current = target;
    directionRef.current = direction;
    switchSegmentRef.current(target);
  }, []);

  const horizontalScroll = useHorizontalScrollOptional();

  const gesture = useMemo(
    () =>
      Gesture.Pan()
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
          if (!touch || event.numberOfTouches !== 1 || widthSv.value <= 0) {
            stateManager.fail();
            return;
          }
          const decision = decideShellSwipe(
            {
              deltaX: touch.absoluteX - touchStartX.value,
              deltaY: touch.absoluteY - touchStartY.value,
            },
            {
              // 内层先决：segment posture 在场时 stackInFront 不参与（祖先面的
              // 让位/接管是 RNGH 仲裁的事，不是这里的事）。
              stackInFront: false,
              blocked: blockedSv.value || turningSv.value,
              horizontalScrolled:
                horizontalScroll?.isAnyScrolledRight.value === true ||
                horizontalScroll?.activeGestureStartedScrolled.value === true,
              segment: { index: indexSv.value, count: countSv.value },
            },
          );
          if (decision.role !== "files-segment") {
            stateManager.fail();
            return;
          }
          // activate = 本面接管（RNGH 随即 cancel 祖先 stack-back/ring 的 Pan）；
          // fail = 边界/灰段/豁免 = 同流让位祖先面（级联的唯一移交点）。
          if (decision.intent === "activate") stateManager.activate();
          else if (decision.intent === "fail") stateManager.fail();
        })
        .onUpdate((event) => {
          // 手动激活会重置行程原点（同环口径），位移从 0 起跟手。
          tx.value = clampRingSwipeTranslation(event.translationX, widthSv.value);
        })
        .onEnd((event, success) => {
          if (!success) {
            tx.value = withTiming(0, { duration: SNAP_BACK_MS });
            return;
          }
          const decision = decideFilesSegmentRelease({
            translationX: tx.value,
            velocityX: event.velocityX,
            posture: { index: indexSv.value, count: countSv.value },
            widthDp: widthSv.value,
          });
          if (decision.kind === "snap-back") {
            tx.value = withTiming(0, { duration: SNAP_BACK_MS });
            return;
          }
          turningSv.value = true;
          tx.value = withTiming(decision.exitEdge, { duration: EXIT_MS }, (finished) => {
            if (!finished) {
              turningSv.value = false;
              return;
            }
            runOnJS(land)(decision.target, decision.direction);
          });
        }),
    [
      blockedSv,
      countSv,
      horizontalScroll,
      indexSv,
      land,
      touchStartX,
      touchStartY,
      turningSv,
      tx,
      widthSv,
    ],
  );

  const surfaceStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const onSurfaceLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    // 0.5dp 死区（环同款）：布局回写同宽不重渲染，防 layout↔render 回环。
    setMeasuredWidthDp((prev) => (prev != null && Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);

  return { gesture, surfaceStyle, onSurfaceLayout };
}
