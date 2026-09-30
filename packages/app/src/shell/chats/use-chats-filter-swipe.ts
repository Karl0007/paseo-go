// B4-SWIPE (批次四 F5 裁定 10) — the actuator half of the 对话页横滑切换: a Reanimated
// horizontal Pan over the chat list that flips the screen's existing filter state.
//
// Topology (mirrors the two on-device-proven parent-pan hosts in this app: the
// official explorer's open gesture on `components/compact-explorer-sidebar-host.tsx`
// and the shell edge-back on `session-header/use-shell-edge-back-gesture.ts`): the
// Pan sits on an ANCESTOR of the scrollable, activates manually from a pure
// direction lock, and drives one shared value that becomes a `translateX`.
//
// Why manual activation instead of `.activeOffsetX()/.failOffsetY()`: the drag gate
// has to be readable mid-touch. 裁定 10 forbids a page switch while the 置顶 drag is
// live, and B4-REGRESS's ruling is that any state band which flips DraggableList
// props IS a remount surface (that is what killed the long-press menu). So the gate
// is a shared value the worklet reads — `blocked` never rebuilds the gesture, never
// re-renders the list, and cannot unmount anything:
//
//   arm(180ms) → menu_open(250ms) → dragging   ⇔   screen `gestureLock`
//
// `gestureLock` is the row machine's own lock band (chat-list-row → useShellRowDragMenu
// → onGestureLockChange), true for the whole arm→menu→drag decision and released by
// the drop handler out-of-band (R2-01). Gating on it is strictly wider than "drag
// active": a row that merely armed (finger stationary 180ms) already belongs to the
// drag layer — `decideLongPressMove` starts the drag on any 8px move from there,
// horizontal included — so the swipe yields for the entire band. A swipe that moves
// before 180ms never arms: the row machine takes `horizontal_swipe` → `list_owns`
// (terminal, press swallowed) and the page turns.
//
// The page turn itself is two beats on one shared value, because exactly ONE list is
// mounted (a second one for the incoming page would be a remount surface and a second
// FlatList): the outgoing page slides to the wall, the screen's filter state flips
// (the same `setFilter` the header segment presses), and the same surface — now
// showing the other page's data — enters from the opposite wall.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { isCompactWindowWidth, tabletColumnsForWidth } from "@/shell/tablet/form-factor";
import {
  clampFilterSwipeTranslation,
  decideFilterSwipeRelease,
  filterSwipeEntryEdge,
  resolveFilterSwipeIntent,
  type FilterSwipePage,
} from "./filter-swipe";

/** 出场/进场/回弹三拍时长（ms）。换页是「吸附」不是甩动：定长 timing，帧可预期。 */
const EXIT_MS = 140;
const ENTER_MS = 180;
const SNAP_BACK_MS = 180;

export function useChatsFilterSwipe(input: {
  /** 当前页（由屏幕的 filter state 投影；点 segment 改的也是它）。 */
  page: FilterSwipePage;
  /** 行手势独占期间（arm→menu→drag）禁页切换。 */
  blocked: boolean;
  /** 换页落地：屏幕现有的 filter setter（与点 segment 同一条路径）。 */
  onSwitchPage: (page: FilterSwipePage) => void;
}) {
  const { page, blocked, onSwitchPage } = input;

  // 列宽：首帧种子用窗口形态学（与 B4-HEADER 的 segment 档位同源——同一个分栏列），
  // onLayout 实测后接管。宽度只进共享值，不进手势的 useMemo 依赖。
  const { width: windowWidthDp } = useWindowDimensions();
  const seedWidthDp = isCompactWindowWidth(windowWidthDp)
    ? windowWidthDp
    : tabletColumnsForWidth(windowWidthDp).list;
  const [measuredWidthDp, setMeasuredWidthDp] = useState<number | null>(null);
  const widthDp = measuredWidthDp ?? seedWidthDp;

  const tx = useSharedValue(0);
  const pageSv = useSharedValue(page);
  const widthSv = useSharedValue(widthDp);
  const blockedSv = useSharedValue(blocked);
  /** 换页两拍进行中：期间不吃新手势（否则中途改目标页=两拍错乱）。 */
  const turningSv = useSharedValue(false);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  const switchPageRef = useRef(onSwitchPage);
  useEffect(() => {
    switchPageRef.current = onSwitchPage;
  }, [onSwitchPage]);
  useEffect(() => {
    pageSv.value = page;
  }, [page, pageSv]);
  useEffect(() => {
    widthSv.value = widthDp;
  }, [widthDp, widthSv]);
  useEffect(() => {
    blockedSv.value = blocked;
  }, [blocked, blockedSv]);

  /** 出场拍结束→setter→本 ref 让进场拍知道该从哪面墙进。 */
  const pendingEntryRef = useRef<FilterSwipePage | null>(null);

  const commitPage = useCallback((target: FilterSwipePage) => {
    pendingEntryRef.current = target;
    switchPageRef.current(target);
  }, []);

  // 数据已换成新页（filter 变→derive 变→FlatList data 正常更新，不是重挂）。
  // 面板此刻停在出场那面墙外，把它挪到对侧再推进来。
  useEffect(() => {
    const pending = pendingEntryRef.current;
    if (pending === null) return;
    pendingEntryRef.current = null;
    if (pending !== page) {
      // 两拍途中用户点了 segment（换到手势目标以外的页）：不做进场，归位即可。
      tx.value = withTiming(0, { duration: SNAP_BACK_MS });
      turningSv.value = false;
      return;
    }
    // 先瞬移到对侧墙外（与新的 data 同一批 UI 线程写入），再吸附进场。
    tx.value = filterSwipeEntryEdge(page, widthSv.value);
    tx.value = withTiming(0, { duration: ENTER_MS }, () => {
      turningSv.value = false;
    });
  }, [page, tx, widthSv, turningSv]);

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
          if (blockedSv.value || turningSv.value || widthSv.value <= 0) {
            stateManager.fail();
            return;
          }
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }
          const intent = resolveFilterSwipeIntent({
            deltaX: touch.absoluteX - touchStartX.value,
            deltaY: touch.absoluteY - touchStartY.value,
            page: pageSv.value,
          });
          if (intent === "activate") stateManager.activate();
          else if (intent === "fail") stateManager.fail();
        })
        .onUpdate((event) => {
          // 手动激活会重置行程原点（PanGestureHandler.activate → resetProgress），
          // 所以位移从 0 起跟手，激活阈值不会在换页瞬间跳一帧。
          tx.value = clampFilterSwipeTranslation(event.translationX, pageSv.value, widthSv.value);
        })
        .onEnd((event, success) => {
          if (!success) {
            tx.value = withTiming(0, { duration: SNAP_BACK_MS });
            return;
          }
          const decision = decideFilterSwipeRelease({
            translationX: tx.value,
            velocityX: event.velocityX,
            page: pageSv.value,
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
            runOnJS(commitPage)(decision.page);
          });
        }),
    [blockedSv, commitPage, pageSv, touchStartX, touchStartY, turningSv, tx, widthSv],
  );

  const surfaceStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const onSurfaceLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    // 0.5dp 死区（B4-HEADER 同款）：布局回写同宽不重渲染，防 layout↔render 回环。
    setMeasuredWidthDp((prev) => (prev != null && Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);

  return { gesture, surfaceStyle, onSurfaceLayout };
}
