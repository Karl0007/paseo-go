// B8-SWIPE (F26) — the actuator half of the 横滑 tab 环, replacing B4-SWIPE's
// `use-chats-filter-swipe` (same topology, same beats, wider ring): a Reanimated
// horizontal Pan over the tab screen's content column that moves the ring state
// machine (`tab-ring.ts`) through `decideShellSwipe` (`swipe-machine.ts`).
//
// Topology unchanged (the two on-device-proven parent-pan hosts): the Pan sits on
// an ANCESTOR of the scrollable, activates manually from the pure direction lock,
// and drives one shared value that becomes a `translateX`. Gates are shared
// values the worklet reads — `blocked`/`frontmost` never rebuild the gesture and
// never re-render the list (B4-REGRESS 重挂面纪律).
//
// The commit lands through the SCREEN's own setter: chats 0↔1 is the segment's
// `setFilter` (same state machine as a segment press, 裁定 10 延续); a cross-tab
// target is the rail's own verb `router.navigate(SHELL.*)` — the exiting surface
// parks at its wall, `armRingTransition` carries the entrance direction across
// the navigation, and the target screen plays the entry on its focus beat (or on
// mount when it was never mounted — lazy tabs). A plain tab-bar tap arrives with
// no pending transition: the parked surface is reset flat.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import type { ShellTab } from "@/shell/stores/settings";
import { isCompactWindowWidth, tabletColumnsForWidth } from "@/shell/tablet/form-factor";
import { decideShellSwipe } from "./swipe-machine";
import {
  armRingTransition,
  consumeRingTransitionForSection,
  getShellFrontmostSection,
  subscribeShellFrontmost,
} from "./ring-transition";
import {
  clampRingSwipeTranslation,
  decideRingSwipeRelease,
  ringEntryEdge,
  ringSectionForSlot,
  type RingDirection,
  type RingSlot,
} from "./tab-ring";

/** 出场/进场/回弹三拍时长（ms）——段内滑实测值原样进环（吸附不是甩动，帧可预期）。 */
const EXIT_MS = 140;
const ENTER_MS = 180;
const SNAP_BACK_MS = 180;

export function useShellRingSwipe(input: {
  /** 本屏所属 section（焦点总线/落地导航的键）。 */
  section: ShellTab;
  /** 当前环格（屏幕状态投影；chats 由 filter state 投 0/1）。 */
  slot: RingSlot;
  /** 本屏的互斥带：行拖拽 arm→menu→drag、搜索态。 */
  blocked: boolean;
  /** 换页落地：本屏 setter（环内）或官方 tab 动词（跨 tab）。 */
  onSwitchSlot: (target: RingSlot) => void;
}) {
  const { section, slot, blocked, onSwitchSlot } = input;

  // 列宽：首帧种子用窗口形态学（与段内滑同源——同一个分栏列），onLayout 实测接管。
  const { width: windowWidthDp } = useWindowDimensions();
  const seedWidthDp = isCompactWindowWidth(windowWidthDp)
    ? windowWidthDp
    : tabletColumnsForWidth(windowWidthDp).list;
  const [measuredWidthDp, setMeasuredWidthDp] = useState<number | null>(null);
  const widthDp = measuredWidthDp ?? seedWidthDp;

  const tx = useSharedValue(0);
  const slotSv = useSharedValue(slot);
  const widthSv = useSharedValue(widthDp);
  const blockedSv = useSharedValue(blocked);
  /** 堆叠页/别的 tab 在前：环手势让位（F27 堆叠优先的运行时闸）。 */
  const frontmostSv = useSharedValue(getShellFrontmostSection() === section);
  /** 换页两拍进行中：期间不吃新手势（否则中途改目标页=两拍错乱）。 */
  const turningSv = useSharedValue(false);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const switchSlotRef = useRef(onSwitchSlot);
  useEffect(() => {
    switchSlotRef.current = onSwitchSlot;
  }, [onSwitchSlot]);
  useEffect(() => {
    widthSv.value = widthDp;
  }, [widthDp, widthSv]);
  useEffect(() => {
    blockedSv.value = blocked;
  }, [blocked, blockedSv]);

  /** 本次换页的方向（进场从哪面墙）+ 环内目标（slot prop 变化拍消费）。 */
  const directionRef = useRef<RingDirection>("forward");
  const localTargetRef = useRef<RingSlot | null>(null);
  const slotRef = useRef(slot);

  const playEntry = useCallback(
    (direction: RingDirection) => {
      // 先瞬移到对侧墙外（与新数据同一批 UI 线程写入），再吸附进场。
      tx.value = ringEntryEdge(direction, widthSv.value);
      tx.value = withTiming(0, { duration: ENTER_MS }, () => {
        turningSv.value = false;
      });
    },
    [tx, widthSv, turningSv],
  );

  // slot 投影变化 = 环内换页的进场拍（本屏 setFilter 落地后）；两拍途中用户点了
  // segment（换到手势目标以外的格）：不做进场，归位即可。
  useEffect(() => {
    slotRef.current = slot;
    slotSv.value = slot;
    const local = localTargetRef.current;
    if (local === null) return;
    localTargetRef.current = null;
    if (local !== slot) {
      tx.value = withTiming(0, { duration: SNAP_BACK_MS });
      turningSv.value = false;
      return;
    }
    playEntry(directionRef.current);
  }, [slot, slotSv, tx, turningSv, playEntry]);

  // 焦点拍（(shell) 布局的导航监听代发）：取走属于自己的进场；无进场就是把停在
  // 出场墙上的自家表面归零（tab bar 普通点入）。挂载即补一拍——lazy tab 的首次
  // 聚焦事件可能落在本 hook 订阅之前。
  useEffect(() => {
    const onBeat = (focused: ShellTab | null) => {
      frontmostSv.value = focused === section;
      if (focused !== section) return;
      const taken = consumeRingTransitionForSection(section);
      if (taken !== null) {
        turningSv.value = true;
        if (slotRef.current !== taken.target) {
          // 跨 tab 落回 chats 的「另一格」：先走本屏 setter，slot prop 变化拍进场。
          directionRef.current = taken.direction;
          localTargetRef.current = taken.target;
          switchSlotRef.current(taken.target);
        } else {
          playEntry(taken.direction);
        }
        return;
      }
      // 普通点入：出场拍停下的表面归零。跨 tab 换页把 turning 旗交给了目标屏，
      // 本屏这场动画永远不会再进——焦点拍就是它的清旗时机（环内两拍期间焦点
      // 不变、无拍，进场中的极端回焦拍归零也是对的：那 180ms 里屏幕在身后）。
      if (tx.value !== 0) tx.value = 0;
      turningSv.value = false;
    };
    const unsubscribe = subscribeShellFrontmost(onBeat);
    onBeat(getShellFrontmostSection());
    return unsubscribe;
  }, [section, frontmostSv, turningSv, tx, playEntry]);

  /**
   * 出场拍结束→落地：环内走本屏 setter，跨 tab 挂进场方向后走官方 tab 动词。
   *
   * 落地前先复核出发条件（REVIEW-B8-03）：出场拍那 140ms 里用户可能已经点了 rail
   * （frontmost→他 tab）或点了会话行（frontmost→堆叠页=null），JS 侧的导航比这次回调
   * 先到。此时再 arm+navigate 就是把用户刚打开的东西弹掉（跨 tab 劫持），所以只有本
   * section 仍在最前才提交；否则丢弃——表面归零（与焦点拍的普通点入同款写法：这块屏幕
   * 在身后，跳变看不见，回焦时也不需要进场）、清 turning、不 arm 不 navigate。
   */
  const land = useCallback(
    (target: RingSlot, direction: RingDirection) => {
      if (getShellFrontmostSection() !== section) {
        tx.value = 0;
        turningSv.value = false;
        return;
      }
      directionRef.current = direction;
      if (ringSectionForSlot(target) === section) {
        localTargetRef.current = target;
      } else {
        armRingTransition({ target, direction });
      }
      switchSlotRef.current(target);
    },
    [section, tx, turningSv],
  );

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
              // 堆叠优先：非本 section 在前（(detail)/官方 push 盖住）→ 环不表态。
              stackInFront: !frontmostSv.value,
              blocked: blockedSv.value || turningSv.value,
              horizontalScrolled:
                horizontalScroll?.isAnyScrolledRight.value === true ||
                horizontalScroll?.activeGestureStartedScrolled.value === true,
            },
          );
          if (decision.role !== "tab-ring") {
            stateManager.fail();
            return;
          }
          if (decision.intent === "activate") stateManager.activate();
          else if (decision.intent === "fail") stateManager.fail();
        })
        .onUpdate((event) => {
          // 手动激活会重置行程原点（PanGestureHandler.activate → resetProgress），
          // 所以位移从 0 起跟手，激活阈值不会在换页瞬间跳一帧。
          tx.value = clampRingSwipeTranslation(event.translationX, widthSv.value);
        })
        .onEnd((event, success) => {
          if (!success) {
            tx.value = withTiming(0, { duration: SNAP_BACK_MS });
            return;
          }
          const decision = decideRingSwipeRelease({
            translationX: tx.value,
            velocityX: event.velocityX,
            slot: slotSv.value,
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
      frontmostSv,
      horizontalScroll,
      land,
      slotSv,
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
    // 0.5dp 死区（B4-HEADER 同款）：布局回写同宽不重渲染，防 layout↔render 回环。
    setMeasuredWidthDp((prev) => (prev != null && Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);

  return { gesture, surfaceStyle, onSurfaceLayout };
}
