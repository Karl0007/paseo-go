// B4-BACK 验收（壳侧单测）：返回键搜索优先的注册/退订/优先级纯逻辑。
// RN fake 复刻 BackHandler.android.js 的确切语义：push 入列、自尾向前派发、
// 首个 true 消费（=「后注册先响应」——菜单>搜索>页面 的时序地基）。
// 路由态 fixture 用真实 router 名字面量（R2-23 纪律：fixture 不取被比对常量，
// 常量漂移必须在这里红，而不是和 matcher 一起绿）。
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rn = vi.hoisted(() => {
  type Handler = () => boolean | null | undefined;
  const handlers: Handler[] = [];
  return {
    os: "android" as string,
    handlers,
    /** RN 的派发：自尾向前，首个 true 消费；无人认领 = 默认页面返回。 */
    press(): "consumed" | "default-back" {
      for (let i = handlers.length - 1; i >= 0; i -= 1) {
        if (handlers[i]?.() === true) return "consumed";
      }
      return "default-back";
    },
  };
});

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return rn.os;
    },
  },
  BackHandler: {
    addEventListener: (_type: string, handler: () => boolean | null | undefined) => {
      rn.handlers.push(handler);
      return {
        remove: () => {
          const index = rn.handlers.indexOf(handler);
          if (index !== -1) rn.handlers.splice(index, 1);
        },
      };
    },
  },
}));

const nav = vi.hoisted(() => ({
  stack: undefined as unknown,
}));

vi.mock("expo-router", () => {
  // Stable ref object — the real useRootNavigation returns the same container
  // ref every render; the effect's subscription lifetime depends on it.
  const navigation = { getState: () => ({ routes: [{ state: nav.stack }] }) };
  return { useRootNavigation: () => navigation };
});

import {
  deepestFocusedRoute,
  ownsFrontmostRoute,
  type BackPriorityStateLike,
} from "./shell-back-priority";
import { useShellSearchBackPriority } from "./use-shell-search-back-priority";

const noop = () => {};

// ---- fixtures -------------------------------------------------------------
// 真实形态：容器 state 只有一个 __root 路由，其嵌套 state 才是 app Stack
// ((shell)/(detail)/h/[serverId] 所在层)。hook 读的就是 routes[0].state。
function container(appStack: BackPriorityStateLike | undefined) {
  nav.stack = appStack;
}

const SHELL_STACK_CHATS: BackPriorityStateLike = {
  index: 0,
  routes: [
    {
      name: "(shell)",
      state: {
        index: 0,
        routes: [{ name: "chats" }, { name: "workspace" }, { name: "me" }],
      },
    },
  ],
};

const SHELL_STACK_WORKSPACE: BackPriorityStateLike = {
  index: 0,
  routes: [
    {
      name: "(shell)",
      state: {
        index: 1,
        routes: [{ name: "chats" }, { name: "workspace" }, { name: "me" }],
      },
    },
  ],
};

/** 真机形态（B4-BACK probe 2026-10-01 实锤）：(detail) group 是折叠路由——父
 * state 里无嵌套 state，真实叶子折在 params.screen/params.params。fixture 直接
 * 钉这个形状，而不是理想化的嵌套 Stack。 */
function detailOnTop(screen: string, params: Record<string, unknown> = {}): BackPriorityStateLike {
  return {
    index: 1,
    routes: [{ ...SHELL_STACK_CHATS.routes[0] }, { name: "(detail)", params: { screen, params } }],
  };
}

// ---- pure: deepestFocusedRoute ---------------------------------------------
describe("deepestFocusedRoute", () => {
  it("drills every nested navigator down to the focused leaf", () => {
    expect(deepestFocusedRoute(SHELL_STACK_CHATS)?.name).toBe("chats");
    expect(deepestFocusedRoute(SHELL_STACK_WORKSPACE)?.name).toBe("workspace");
  });

  it("unfolds a folded group route to its screen + inner params", () => {
    const route = deepestFocusedRoute(
      detailOnTop("files/[serverId]/[workspaceId]", { serverId: "s1", workspaceId: "w1" }),
    );
    expect(route?.name).toBe("files/[serverId]/[workspaceId]");
    expect(route?.params).toEqual({ serverId: "s1", workspaceId: "w1" });
  });

  it("real nested state wins over a stale params.screen on the same route", () => {
    const route = deepestFocusedRoute({
      index: 0,
      routes: [
        {
          name: "(shell)",
          params: { screen: "me" },
          state: { index: 0, routes: [{ name: "chats" }] },
        },
      ],
    });
    expect(route?.name).toBe("chats");
  });

  it("folded leaf without inner params still names the screen", () => {
    expect(deepestFocusedRoute(detailOnTop("import"))?.name).toBe("import");
  });

  it("no state / no routes → null (fail-open input)", () => {
    expect(deepestFocusedRoute(undefined)).toBeNull();
    expect(deepestFocusedRoute({ routes: [] })).toBeNull();
  });

  it("out-of-range index clamps instead of throwing mid-press", () => {
    const route = deepestFocusedRoute({ index: 9, routes: [{ name: "chats" }] });
    expect(route?.name).toBe("chats");
  });
});

// ---- pure: ownsFrontmostRoute ----------------------------------------------
describe("ownsFrontmostRoute", () => {
  it("a tab claims only while IT is the focused tab", () => {
    expect(ownsFrontmostRoute(SHELL_STACK_CHATS, { name: "chats" })).toBe(true);
    expect(ownsFrontmostRoute(SHELL_STACK_CHATS, { name: "workspace" })).toBe(false);
    expect(ownsFrontmostRoute(SHELL_STACK_WORKSPACE, { name: "workspace" })).toBe(true);
  });

  it("a tab loses the claim when any detail is pushed on top", () => {
    const pushed = detailOnTop("preview", { path: "a.md" });
    expect(ownsFrontmostRoute(pushed, { name: "chats" })).toBe(false);
  });

  it("files: prefix+params match own screen, not another workspace's copy", () => {
    const identity = { namePrefix: "files/", params: { serverId: "s1", workspaceId: "w1" } };
    expect(
      ownsFrontmostRoute(
        detailOnTop("files/[serverId]/[workspaceId]", { serverId: "s1", workspaceId: "w1" }),
        identity,
      ),
    ).toBe(true);
    // 同屏堆两份：上面那份是 w2，w1 的搜索不得吞它的返回。
    expect(
      ownsFrontmostRoute(
        detailOnTop("files/[serverId]/[workspaceId]", { serverId: "s1", workspaceId: "w2" }),
        identity,
      ),
    ).toBe(false);
    // preview 压在 files 上：deepest 是 preview，params 不含 workspaceId。
    expect(ownsFrontmostRoute(detailOnTop("preview", { path: "a.md" }), identity)).toBe(false);
  });

  it("an identity that cannot name itself claims nothing; no state fails open", () => {
    expect(ownsFrontmostRoute(SHELL_STACK_CHATS, {})).toBe(false);
    expect(ownsFrontmostRoute(undefined, { name: "chats" })).toBe(false);
  });
});

// ---- hook: register / unsubscribe / priority --------------------------------
describe("useShellSearchBackPriority", () => {
  beforeEach(() => {
    rn.handlers.length = 0;
    rn.os = "android";
    container(SHELL_STACK_CHATS);
  });

  it("inactive → no subscription; active → exactly one; close → gone (卸载即退)", () => {
    const { rerender } = renderHook(
      ({ active }) => {
        useShellSearchBackPriority(active, noop, { name: "chats" });
      },
      { initialProps: { active: false } },
    );
    expect(rn.handlers).toHaveLength(0);

    rerender({ active: true });
    expect(rn.handlers).toHaveLength(1);

    rerender({ active: false });
    expect(rn.handlers).toHaveLength(0);
  });

  it("web never subscribes (react-native-web BackHandler errors on subscribe)", () => {
    rn.os = "web";
    renderHook(() => {
      useShellSearchBackPriority(true, noop, { name: "chats" });
    });
    expect(rn.handlers).toHaveLength(0);
  });

  it("frontmost + active: press exits the search and is consumed (不切页)", () => {
    const onExit = vi.fn();
    renderHook(() => {
      useShellSearchBackPriority(true, onExit, { name: "chats" });
    });
    expect(rn.press()).toBe("consumed");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("background search does NOT swallow the front screen's back (页面返回照走)", () => {
    // 页面返回 = 更早注册的订阅（此处即「无人认领→默认返回」的替身）。
    const pageBack = vi.fn(() => true);
    rn.handlers.push(pageBack);
    renderHook(() => {
      useShellSearchBackPriority(true, vi.fn(), { name: "chats" });
    });
    container(detailOnTop("preview"));
    expect(rn.press()).toBe("consumed");
    expect(pageBack).toHaveBeenCalledTimes(1);
  });

  it("菜单 > 搜索: the later registration (open menu) claims first, search after it closes", () => {
    const onExit = vi.fn();
    const menuClose = vi.fn(() => true);
    renderHook(() => {
      useShellSearchBackPriority(true, onExit, { name: "chats" });
    });
    // 菜单在搜索之后挂载 → 入列更靠尾 → 先响应（chat-row-menu.tsx 同款注册）。
    rn.handlers.push(menuClose);
    expect(rn.press()).toBe("consumed");
    expect(menuClose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    // 菜单关闭即退订，搜索重新拿到这一按。
    rn.handlers.splice(rn.handlers.indexOf(menuClose), 1);
    expect(rn.press()).toBe("consumed");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("latest onExit/identity ride the SAME subscription (顺序不因重渲染漂移)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onExit }: { onExit: () => void }) => {
        useShellSearchBackPriority(true, onExit, { name: "chats" });
      },
      { initialProps: { onExit: first } },
    );
    rerender({ onExit: second });
    expect(rn.handlers).toHaveLength(1);
    rn.press();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("act() around state flips keeps the subscription honest mid-navigation", () => {
    const onExit = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useShellSearchBackPriority(active, onExit, { name: "chats" });
      },
      { initialProps: { active: true } },
    );
    // 切到工作区 tab：搜索仍 active（tab 体不卸载），但 frontmost 不再属于对话。
    container(SHELL_STACK_WORKSPACE);
    expect(rn.press()).toBe("default-back");
    expect(onExit).not.toHaveBeenCalled();
    act(() => {
      rerender({ active: false });
    });
    expect(rn.handlers).toHaveLength(0);
  });
});
