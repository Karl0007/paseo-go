// @vitest-environment jsdom
// REVIEW-B8-02 (P1) 的机器闸：环的换页面板必须挂上 `ring.surfaceStyle`。
// 工作区/我的两屏当年只挂了静态 styles.swipeSurface，`ring.surfaceStyle` 全库只有
// 对话屏消费——于是那两屏的跟手位移/出场/进场/回弹整屏不可见，提交瞬间跳变。
// 这里渲染真实屏体（环 hook 换成给出可辨识 surfaceStyle 的替身），断言「裁切内容区
// 的那一层」就是带上 animated transform 的那一层：漏挂即红。
import React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { MeScreenBody } from "@/shell/components/me-screen-body";
import { WorkspaceScreenBody } from "@/shell/components/workspace-screen-body";

// useAnimatedStyle 的输出在 jsdom 里就是一个普通 style 对象；42 是替身专属的位移值，
// 屏体若没把它并进 swipeSurface 的 style，下面的断言拿不到 transform。
const RING_SURFACE_STYLE = { transform: [{ translateX: 42 }] } as const;

vi.mock("@/shell/gestures/use-shell-ring-swipe", () => ({
  useShellRingSwipe: () => ({
    gesture: {},
    surfaceStyle: RING_SURFACE_STYLE,
    onSurfaceLayout: () => {},
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: vi.fn() }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn(async () => {}) }));
// 手势面（GestureDetector）与导航动词不是本卡的断言对象：前者在 jsdom 里需要真实
// gesture 对象（toGestureArray），后者要 navigator；都换成最小替身，屏体照常渲染。
vi.mock("react-native-gesture-handler", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});
vi.mock("expo-router", () => ({
  Redirect: () => null,
  Stack: () => null,
  router: {
    navigate: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    canGoBack: () => true,
  },
  useGlobalSearchParams: () => ({}),
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useRootNavigation: () => undefined,
  useRootNavigationState: () => ({ key: "root" }),
  useRouter: () => ({ navigate: vi.fn(), push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

function renderBody(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/**
 * 换页面板的身份：三屏同款结构 = [顶栏 | 面板(裁切+位移) | 浮层]，面板是顶栏的下一个
 * 兄弟节点，且是唯一带 overflow:hidden 的那层（styles.swipeSurface 的定义性属性：
 * 「滑到墙外」必须真被裁掉，iOS 默认溢出可见）。
 */
function swipeSurfaceOf(container: HTMLElement): HTMLElement {
  const header = container.querySelector<HTMLElement>('[data-testid="shell-tab-header"]');
  expect(header, "顶栏未渲染，屏体没渲染出来").not.toBeNull();
  const surface = header?.nextElementSibling as HTMLElement | null;
  expect(surface?.style.overflowX, "顶栏后面板缺失").toBe("hidden");
  return surface as HTMLElement;
}

describe("B8-SWIPE 换页面板挂载面（REVIEW-B8-02）", () => {
  it("工作区屏的 swipeSurface 带 ring.surfaceStyle 的 animated transform", () => {
    const { container } = renderBody(<WorkspaceScreenBody />);
    expect(swipeSurfaceOf(container).style.transform).toBe("translateX(42px)");
  });

  it("我的屏的 swipeSurface 带 ring.surfaceStyle 的 animated transform", () => {
    const { container } = renderBody(<MeScreenBody />);
    expect(swipeSurfaceOf(container).style.transform).toBe("translateX(42px)");
  });
});
