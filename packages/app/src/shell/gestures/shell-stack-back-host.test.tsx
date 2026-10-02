// @vitest-environment jsdom
// REVIEW-B8-09 重拍的产物：F27 的返回 Pan 必须挂在栈页的【祖先】面上。
// 初版把一层无子节点的 box-none 图层 Portal 进 content-floating-panels，真机上
// import 链完好、frontmost=true、blocked=false，Pan 却一次 touchesDown 都没收到
// （该层是导航器的兄弟，命中测试落在它下面的屏幕上，那次触摸的 handler 链里没有它），
// 于是「全宽右滑返回」在 import/commands-edit 两屏全部不响应。
// 这里钉住结构：(detail) 布局渲染出的 Stack 必须落在手势面（GestureDetector 的子树）里，
// 并且只在 (detail) 组真的在最前时 enabled（官方会话屏上让位给胶囊的左缘带）。
import React from "react";
import { render } from "@testing-library/react";
import { View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => ({ enabledCalls: [] as boolean[] }));

vi.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => {
      const pan = {
        maxPointers: () => pan,
        manualActivation: () => pan,
        onTouchesDown: () => pan,
        onTouchesMove: () => pan,
        onEnd: () => pan,
        enabled: (value: boolean) => {
          rig.enabledCalls.push(value);
          return pan;
        },
      };
      return pan;
    },
  },
  GestureDetector: ({ children }: { children: React.ReactNode }) => (
    <View testID="gesture-host">{children}</View>
  ),
}));
vi.mock("react-native-reanimated", () => ({
  useSharedValue: <T,>(initial: T) => ({ value: initial }),
}));
vi.mock("react-native-worklets", () => ({ scheduleOnRN: () => undefined }));
vi.mock("@/shell/detail-back", () => ({ detailBack: vi.fn() }));

// 根栈的可控替身：routes[0] 是 __root，它的嵌套 state 才是 App Stack
// （use-shell-stack-back-overlay 读的就是这一层）。
const stack = vi.hoisted(() => ({
  frontmost: "detail" as "detail" | "shell",
  listeners: new Set<() => void>(),
}));
const DETAIL_GROUP = "(detail)";

vi.mock("expo-router", () => ({
  Stack: () => <View testID="detail-stack" />,
  useRootNavigation: () => ({
    getState: () => ({
      routes: [
        {
          name: "__root",
          state: {
            index: stack.frontmost === "detail" ? 1 : 0,
            routes: [{ name: "(shell)" }, { name: DETAIL_GROUP }],
          },
        },
      ],
    }),
    addListener: (_event: string, handler: () => void) => {
      stack.listeners.add(handler);
      return () => stack.listeners.delete(handler);
    },
  }),
}));

import DetailLayout from "@/app/(detail)/_layout";

function setFrontmost(frontmost: "detail" | "shell") {
  stack.frontmost = frontmost;
  for (const listener of stack.listeners) listener();
}

beforeEach(() => {
  rig.enabledCalls.length = 0;
  stack.listeners.clear();
  setFrontmost("detail");
});

describe("(detail) 组的返回手势挂载面（REVIEW-B8-09）", () => {
  it("手势面是栈页的祖先：栈内每一次触摸的 handler 链都经过它", () => {
    const { getByTestId } = render(<DetailLayout />);
    const host = getByTestId("gesture-host");
    expect(host.contains(getByTestId("detail-stack")), "Stack 不在手势面子树里").toBe(true);
  });

  it("只有 (detail) 组在最前时 Pan 才 enabled（官方会话屏让位给左缘带）", () => {
    const { rerender } = render(<DetailLayout />);
    expect(rig.enabledCalls.at(-1)).toBe(true);

    setFrontmost("shell");
    rerender(<DetailLayout />);
    expect(rig.enabledCalls.at(-1)).toBe(false);
  });
});
