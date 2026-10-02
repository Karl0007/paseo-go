// @vitest-environment jsdom
// REVIEW-B8-03 (P2) 的机器闸：出场拍（EXIT_MS=140）结束时的 land 必须复核出发条件。
// 环提交后那 140ms 里用户点了 rail（frontmost→他 tab）或点了会话行（frontmost→null），
// JS 侧的导航已经先落地；land 若照旧无条件 armRingTransition+navigate，刚打开的东西就被
// 弹掉（跨 tab 劫持）。这里把一次真实提交驱动到「出场动画完成回调」前一步，注入 frontmost
// 变更，再放行回调：提交必须被丢弃（不 navigate、不 arm、tx 归零）。
// 手势/Reanimated 换成本地替身（RNGH 的 Pan 在 jsdom 里点不出来，withTiming 的完成回调
// 需要一个能手动放行的时钟）；环算术、方向锁、frontmost 总线、hook 本体全是真代码。
import { act, renderHook } from "@testing-library/react";
import type { LayoutChangeEvent } from "react-native";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/** 替身只存不改地转发 hook 的 worklet 处理器；方法语法声明 → 参数双向协变，真实处理器可直接挂入。 */
interface PanRig {
  maxPointers(): PanRig;
  manualActivation(): PanRig;
  enabled(value: boolean): PanRig;
  onTouchesDown(handler: (event: unknown, state?: unknown) => void): PanRig;
  onTouchesMove(handler: (event: unknown, state?: unknown) => void): PanRig;
  onUpdate(handler: (event: unknown, state?: unknown) => void): PanRig;
  onEnd(handler: (event: unknown, state?: unknown) => void): PanRig;
}

const rig = vi.hoisted(() => {
  const handlers: Record<string, (event: unknown, state?: unknown) => void> = {
    onTouchesDown: () => undefined,
    onTouchesMove: () => undefined,
    onUpdate: () => undefined,
    onEnd: () => undefined,
  };
  const timings: Array<{ toValue: number; cb?: (finished: boolean) => void }> = [];
  const pan = {
    maxPointers() {
      return pan;
    },
    manualActivation() {
      return pan;
    },
    enabled() {
      return pan;
    },
    onTouchesDown(handler: (event: unknown, state?: unknown) => void) {
      handlers.onTouchesDown = handler;
      return pan;
    },
    onTouchesMove(handler: (event: unknown, state?: unknown) => void) {
      handlers.onTouchesMove = handler;
      return pan;
    },
    onUpdate(handler: (event: unknown, state?: unknown) => void) {
      handlers.onUpdate = handler;
      return pan;
    },
    onEnd(handler: (event: unknown, state?: unknown) => void) {
      handlers.onEnd = handler;
      return pan;
    },
  };
  return { handlers, timings, Gesture: { Pan: (): PanRig => pan } };
});

vi.mock("react-native-gesture-handler", () => rig);
vi.mock("react-native-reanimated", async () => {
  const React = await import("react");
  return {
    // JS 线程语义：共享值就是一个 {value} 盒子，跨渲染稳定。
    useSharedValue: <T,>(initial: T) => React.useState(() => ({ value: initial }))[0],
    // 每次渲染现算，测试就能从 hook 的公开输出口读到当前 tx。
    useAnimatedStyle: <T,>(updater: () => T) => updater(),
    withTiming: (toValue: number, _config: unknown, cb?: (finished: boolean) => void) => {
      rig.timings.push({ toValue, cb });
      return toValue;
    },
    runOnJS: <T,>(fn: T) => fn,
  };
});

import {
  consumeRingTransitionForSection,
  setShellFrontmostSection,
} from "@/shell/gestures/ring-transition";
import { RING_SLOT_ME, RING_SLOT_WORKSPACE } from "@/shell/gestures/tab-ring";
import { useShellRingSwipe } from "@/shell/gestures/use-shell-ring-swipe";

/** 面板列宽（dp）：onLayout 实测值，决定 1/4 列宽的提交阈值与出场墙。 */
const WIDTH_DP = 300;

/** 一次已提交、停在出场墙上的横滑（工作区 → 我的）。 */
interface CommittedSwipe {
  /** 屏递给 hook 的落地动词（跨 tab = router.navigate，环内 = 本屏 setter）。 */
  onSwitchSlot: Mock;
  /** 出场拍的 withTiming 现场；cb(true) = 动画跑完，land 就是从这里进的。 */
  exit: { toValue: number; cb?: (finished: boolean) => void } | undefined;
  /** 重渲染一拍，从 hook 的公开输出口读当前位移（surfaceStyle 的 translateX）。 */
  translateX: () => number;
}

function touch(absoluteX: number, absoluteY = 400) {
  return { changedTouches: [{ absoluteX, absoluteY }], numberOfTouches: 1 };
}

function stateManager() {
  return { activate: vi.fn(), fail: vi.fn() };
}

/** onLayout 现场（jsdom 量不出列宽，测试直接喂实测值）。 */
function layoutEvent(width: number): LayoutChangeEvent {
  return {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 800 }, target: 0, timestamp: 0 },
  } as unknown as LayoutChangeEvent;
}

/** 把工作区屏（环第 3 格）的一次左滑提交推到「出场动画完成回调」前一步。 */
function commitWorkspaceSwipe(): CommittedSwipe {
  const onSwitchSlot = vi.fn();
  const view = renderHook(() =>
    useShellRingSwipe({
      section: "workspace",
      slot: RING_SLOT_WORKSPACE,
      blocked: false,
      onSwitchSlot,
    }),
  );
  act(() => view.result.current.onSurfaceLayout(layoutEvent(WIDTH_DP)));
  const manager = stateManager();
  act(() => rig.handlers.onTouchesDown(touch(400)));
  // 手指左滑 80dp：过 16dp 锁 → 环接管。
  act(() => rig.handlers.onTouchesMove(touch(320), manager));
  expect(manager.activate, "环未接管这次横滑").toHaveBeenCalled();
  act(() => rig.handlers.onUpdate({ translationX: -200 }));
  act(() => rig.handlers.onEnd({ velocityX: 0 }, true));
  const exit = rig.timings.at(-1);
  expect(exit?.toValue, "提交后应滑向左出场墙").toBe(-WIDTH_DP);
  return {
    onSwitchSlot,
    exit,
    translateX: () => {
      act(() => view.rerender());
      const style = view.result.current.surfaceStyle as unknown as {
        transform: Array<{ translateX: number }>;
      };
      return style.transform[0].translateX;
    },
  };
}

beforeEach(() => {
  rig.timings.length = 0;
  for (const section of ["chats", "workspace", "me"] as const) {
    consumeRingTransitionForSection(section);
  }
  setShellFrontmostSection("workspace");
});

describe("useShellRingSwipe land 前复核出发条件（REVIEW-B8-03）", () => {
  it("出场拍内用户点了别的 tab：提交丢弃，不 navigate、不 arm、tx 归零", () => {
    const swipe = commitWorkspaceSwipe();
    // rail 的 onPress 在 JS 侧先落地（140ms 出场拍还没结束）。
    act(() => setShellFrontmostSection("chats"));
    act(() => swipe.exit?.cb?.(true));

    expect(swipe.onSwitchSlot, "frontmost 已离开本 section，仍提交了换页").not.toHaveBeenCalled();
    expect(consumeRingTransitionForSection("me"), "仍给目标格挂了进场").toBeNull();
    expect(swipe.translateX()).toBe(0);
  });

  it("出场拍内用户点了会话行（堆叠页在前）：同样丢弃", () => {
    const swipe = commitWorkspaceSwipe();
    act(() => setShellFrontmostSection(null));
    act(() => swipe.exit?.cb?.(true));

    expect(swipe.onSwitchSlot).not.toHaveBeenCalled();
    expect(swipe.translateX()).toBe(0);
  });

  it("出发条件没变：提交照常落地到目标格（丢弃不是常态特判）", () => {
    const swipe = commitWorkspaceSwipe();
    act(() => swipe.exit?.cb?.(true));

    expect(swipe.onSwitchSlot).toHaveBeenCalledWith(RING_SLOT_ME);
    // 跨 tab 提交把进场方向交给了目标格（工作区 → 我的）。
    expect(consumeRingTransitionForSection("me")).toMatchObject({
      target: RING_SLOT_ME,
      direction: "forward",
    });
    expect(swipe.translateX()).toBe(-WIDTH_DP);
  });

  it("动画被掐断（finished=false）时不落地", () => {
    const swipe = commitWorkspaceSwipe();
    act(() => swipe.exit?.cb?.(false));
    expect(swipe.onSwitchSlot).not.toHaveBeenCalled();
  });

  it("环内提交（对话 进行中→已归档）走本屏 setter：frontmost 仍是本 section 时不丢", () => {
    setShellFrontmostSection("chats");
    const onSwitchSlot = vi.fn();
    const view = renderHook(() =>
      useShellRingSwipe({ section: "chats", slot: 0, blocked: false, onSwitchSlot }),
    );
    act(() => view.result.current.onSurfaceLayout(layoutEvent(WIDTH_DP)));
    const manager = stateManager();
    act(() => rig.handlers.onTouchesDown(touch(400)));
    act(() => rig.handlers.onTouchesMove(touch(320), manager));
    act(() => rig.handlers.onUpdate({ translationX: -200 }));
    act(() => rig.handlers.onEnd({ velocityX: 0 }, true));
    act(() => rig.timings.at(-1)?.cb?.(true));

    expect(onSwitchSlot).toHaveBeenCalledWith(1);
  });
});
