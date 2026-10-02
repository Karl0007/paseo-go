// @vitest-environment jsdom
// B8-FILESWIP (F29) — the actuator beats pinned without a screen: 中段左滑提交
// 走「出场拍 → 本屏 setter(2) → index prop 拍进场」；边界/灰段/搜索态/换页中
// 必须 stateManager.fail()（= 同流让位祖先面，级联的唯一移交点，绝不激活）；
// 两拍途中外部改段打断出场拍（cb finished=false）时 land 必须哑火（setter 不
// 被回卷）。手势/Reanimated 用环测试同款本地替身；段算术、仲裁器、hook 本体
// 全是真代码。
import { act, renderHook } from "@testing-library/react";
import type { LayoutChangeEvent } from "react-native";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/** 替身只存不改地转发 hook 的 worklet 处理器（环测试同款）。 */
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
    useSharedValue: <T,>(initial: T) => React.useState(() => ({ value: initial }))[0],
    useAnimatedStyle: <T,>(updater: () => T) => updater(),
    withTiming: (toValue: number, _config: unknown, cb?: (finished: boolean) => void) => {
      rig.timings.push({ toValue, cb });
      return toValue;
    },
    runOnJS: <T,>(fn: T) => fn,
  };
});

import { useFilesSegmentSwipe } from "@/shell/gestures/use-files-segment-swipe";

/** 面板列宽（dp）：onLayout 实测值，决定 ¼ 列宽提交阈值与出场墙。 */
const WIDTH_DP = 300;

function touch(absoluteX: number, absoluteY = 400) {
  return { changedTouches: [{ absoluteX, absoluteY }], numberOfTouches: 1 };
}

function stateManager() {
  return { activate: vi.fn(), fail: vi.fn() };
}

function layoutEvent(width: number): LayoutChangeEvent {
  return {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 800 }, target: 0, timestamp: 0 },
  } as unknown as LayoutChangeEvent;
}

/** 渲染一次「变更段（中段）」的文件页段 pager，喂好实测列宽。 */
function renderSegment(input: {
  index: number;
  count: number;
  blocked?: boolean;
  onSwitchSegment: Mock;
}) {
  const view = renderHook(
    ({ index, count, blocked }: { index: number; count: number; blocked: boolean }) =>
      useFilesSegmentSwipe({ index, count, blocked, onSwitchSegment: input.onSwitchSegment }),
    {
      initialProps: { index: input.index, count: input.count, blocked: input.blocked ?? false },
    },
  );
  act(() => view.result.current.onSurfaceLayout(layoutEvent(WIDTH_DP)));
  return view;
}

/** 一次方向锁判定：按下 → 横移 delta，返回 stateManager 的表态。 */
function judge(delta: number): { activate: Mock; fail: Mock } {
  const manager = stateManager();
  act(() => rig.handlers.onTouchesDown(touch(400)));
  act(() => rig.handlers.onTouchesMove(touch(400 + delta), manager));
  return manager;
}

beforeEach(() => {
  rig.timings.length = 0;
});

describe("useFilesSegmentSwipe — 段切换两拍", () => {
  it("中段左滑提交：出场拍停左墙 → land 走本屏 setter(2) → index 拍进场", () => {
    const onSwitchSegment = vi.fn();
    const view = renderSegment({ index: 1, count: 3, onSwitchSegment });
    const manager = judge(-80);
    expect(manager.activate, "中段左滑必须被段 pager 接管").toHaveBeenCalled();

    act(() => rig.handlers.onUpdate({ translationX: -200 }));
    act(() => rig.handlers.onEnd({ velocityX: 0 }, true));
    const exit = rig.timings.at(-1);
    expect(exit?.toValue, "提交后应滑向左出场墙").toBe(-WIDTH_DP);
    expect(onSwitchSegment, "出场拍跑完前不得落地换段").not.toHaveBeenCalled();

    // 出场拍完成 → land：本屏 setter 收到目标段序号。
    act(() => exit?.cb?.(true));
    expect(onSwitchSegment).toHaveBeenCalledWith(2);

    // 屏侧 setter 落地后 index prop 变化拍：进场（withTiming 回 0）。
    rig.timings.length = 0;
    act(() => view.rerender({ index: 2, count: 3, blocked: false }));
    expect(rig.timings.at(-1)?.toValue, "index 拍应从对侧墙进场吸附回 0").toBe(0);
    act(() => rig.timings.at(-1)?.cb?.(true));

    // 进场结束后新手势可再被吃（turning 旗已清）：现在停在末段，右滑有左邻。
    const next = judge(80);
    expect(next.activate).toHaveBeenCalled();
  });

  it("两拍途中用户点了页签行（index 变到非目标）：出场拍被打断，land 哑火不越权", () => {
    const onSwitchSegment = vi.fn();
    const view = renderSegment({ index: 1, count: 3, onSwitchSegment });
    judge(-80);
    act(() => rig.handlers.onUpdate({ translationX: -200 }));
    act(() => rig.handlers.onEnd({ velocityX: 0 }, true));
    const exit = rig.timings.at(-1);

    // 用户点了「文件」页签：屏侧 setter 先落地，index 拍发现目标不符 → 归位。
    act(() => view.rerender({ index: 0, count: 3, blocked: false }));
    // 出场拍动画已被 withTiming(0) 顶掉：RNGH 以 finished=false 收尾 → 不 land。
    act(() => exit?.cb?.(false));
    expect(onSwitchSegment, "被打断的出场拍不得再调 setter").not.toHaveBeenCalled();
  });
});

describe("useFilesSegmentSwipe — 边界外抛 = 同流 fail 让位祖先面", () => {
  it("最左段 + 右滑：不激活只 fail（栈页让位 stack-back pop / tab 宿主让位主环）", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 0, count: 3, onSwitchSegment });
    const manager = judge(80);
    expect(manager.activate, "首段右滑绝不许被内层吃掉（wrap 或误吞返回）").not.toHaveBeenCalled();
    expect(manager.fail, "边界必须 fail 让位同一触摸流的祖先面").toHaveBeenCalled();
  });

  it("最右段 + 左滑：不激活只 fail（栈页祖先面对左滑恒 FAIL = 无外抛）", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 2, count: 3, onSwitchSegment });
    const manager = judge(-80);
    expect(manager.activate).not.toHaveBeenCalled();
    expect(manager.fail).toHaveBeenCalled();
  });

  it("最左段 + 左滑照常换段（外抛只发生在缺邻段的方向）", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 0, count: 3, onSwitchSegment });
    expect(judge(-80).activate).toHaveBeenCalled();
  });
});

describe("useFilesSegmentSwipe — 退化与互斥", () => {
  it("灰段退化（非 git count=1）：双向都 fail，只剩外抛", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 0, count: 1, onSwitchSegment });
    expect(judge(-80).activate).not.toHaveBeenCalled();
    const back = judge(80);
    expect(back.activate).not.toHaveBeenCalled();
    expect(back.fail).toHaveBeenCalled();
  });

  it("搜索态 blocked：段手势哑火，触摸流整个让出去", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 1, count: 3, blocked: true, onSwitchSegment });
    const manager = judge(-80);
    expect(manager.activate).not.toHaveBeenCalled();
    expect(manager.fail).toHaveBeenCalled();
  });

  it("换页两拍进行中：新手势 fail（两拍错乱闸）", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 1, count: 3, onSwitchSegment });
    judge(-80);
    act(() => rig.handlers.onUpdate({ translationX: -200 }));
    act(() => rig.handlers.onEnd({ velocityX: 0 }, true));
    // 出场拍未落地（不跑 cb）：turning 旗立着。
    const mid = judge(-80);
    expect(mid.activate, "换页中不得吃第二个手势").not.toHaveBeenCalled();
    expect(mid.fail).toHaveBeenCalled();
  });

  it("行程不足 ¼ 列宽：snap-back，不换段", () => {
    const onSwitchSegment = vi.fn();
    renderSegment({ index: 1, count: 3, onSwitchSegment });
    judge(-80);
    act(() => rig.handlers.onUpdate({ translationX: -50 }));
    act(() => rig.handlers.onEnd({ velocityX: 0 }, true));
    expect(rig.timings.at(-1)?.toValue).toBe(0);
    act(() => rig.timings.at(-1)?.cb?.(true));
    expect(onSwitchSegment).not.toHaveBeenCalled();
  });
});
