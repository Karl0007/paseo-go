// @vitest-environment jsdom
// C30 acceptance 2 (passthrough half, C31-wired, C32-C31-F1 shape): inactive
// adds no rail/column and no split testID — just two transparent flex:1 wrappers
// (the §6 tree claim restated: no visual/layout delta, verified on-device);
// active renders [rail | list bodies | children] and the rail drives navigation
// (§4-3) plus the §4-8 retap. C31 additions pinned here: the list column
// keep-alives visited bodies (切 tab 不重挂, card 裁定 5) and feeds them the
// route-derived selection (§3.2 选中态单一真相). C32 adds the structural half of
// C31-F1: the activation flip must NEVER remount the children subtree (device
// redscreen: RNGH 2.28 dies on the old conditional-shape remount mid-rotation).
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { router, usePathname } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import { OFFICIAL, SHELL } from "@/shell/routes";
import type { ShellSessionVisibilityInput } from "@/shell/session-header/visibility";
import { subscribeRailRetap } from "./rail-events";
import {
  pendingVisits,
  recordVisit,
  registerVisitLedgerDeps,
  resetVisitLedger,
} from "@/shell/chats/visit-ledger";
import ShellTabletSplitHost from "./split-host";

const env = vi.hoisted(() => {
  const theme = {
    colors: {
      accent: "#2563eb",
      foreground: "#111111",
      foregroundMuted: "#666666",
      foregroundExtraMuted: "#999999",
      surface0: "#ffffff",
      surface1: "#fafafa",
      surfaceSidebarSelected: "#eeeeee",
      border: "#e4e4e7",
    },
    spacing: [0, 4, 8, 12, 16, 20, 24, 28, 32],
    fontSize: { xs: 12, sm: 14, base: 16, lg: 18 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    borderWidth: { 1: 1 },
    borderRadius: { base: 4, md: 6, lg: 8, xl: 12, full: 9999 },
  };
  const state = {
    // C31-F1: activation + column widths key off the window-dimension hook
    // (mocked below) — the test drives rotation via `compact`, not a breakpoint.
    compact: false,
    pending: false,
    active: true,
    selectedAgentKey: null as string | null,
  };
  return {
    state,
    StyleSheet: {
      create: (styles: unknown) =>
        typeof styles === "function" ? (styles as (t: typeof theme) => unknown)(theme) : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    useUnistyles: () => ({ theme, rt: { breakpoint: state.compact ? "sm" : "lg" } }),
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: env.StyleSheet,
  withUnistyles: env.withUnistyles,
  useUnistyles: env.useUnistyles,
}));
// The form-factor seam (split activation + rail/list widths, C31-F1) driven directly.
vi.mock("./form-factor", () => ({
  useShellWindowCompact: () => env.state.compact,
  useTabletColumns: () => ({ rail: 64, list: 300 }),
}));
vi.mock("@/shell/use-shell-seam", () => ({
  useShellSeam: () => ({ pending: env.state.pending, active: env.state.active }),
}));
vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo", ensureShellI18n: () => {} }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The real bodies pull the whole data graph (stores, react-query, host runtime);
// the column only mounts/hides/feeds them, so stubs carry the observable contract.
vi.mock("@/shell/components/chats-screen-body", () => ({
  ChatsScreenBody: ({ selectedAgentKey }: { selectedAgentKey?: string | null }) => (
    <Text testID="body-chats">{selectedAgentKey ?? "none"}</Text>
  ),
}));
vi.mock("@/shell/components/workspace-screen-body", () => ({
  WorkspaceScreenBody: ({ selectedAgentKey }: { selectedAgentKey?: string | null }) => (
    <Text testID="body-workspace">{selectedAgentKey ?? "none"}</Text>
  ),
}));
vi.mock("@/shell/components/me-screen-body", () => ({
  MeScreenBody: () => <Text testID="body-me">me</Text>,
}));
// KI-11: the window-hosted row menu is a leaf overlay of this tree (its own
// contract lives in chat-row-menu-host.test.tsx); the engine surface chain it
// imports needs the full theme, out of scope for the structural contract here.
vi.mock("@/shell/components/chat-row-menu", () => ({
  ShellRowMenuHost: () => null,
}));
vi.mock("./use-tablet-selection", () => ({
  useTabletSelectedAgentKey: () => env.state.selectedAgentKey,
}));

// REVIEW-B8-14 (C21 左缘带兜底，卡 09 同款拓扑裁定): 兜底 Pan 必须挂在会话屏的
// 【祖先】面上。胶囊的 Portal 层是导航器的兄弟、32dp 带锚点是 pointerEvents="none"
// （不可命中），中段起滑从不进 handler 链——真机裁定（2026-10-02）：bar 区起滑 pop、
// 屏幕中段三组 y/时长起滑全部无响应。以下替身把兜底宿主（经 split-host 挂载）需要的
// 手势/可见性面接成可控桩；可见性输入走真实纯谓词 shouldEnableShellEdgeBack。
const edgeRig = vi.hoisted(() => ({
  enabledCalls: [] as boolean[],
  base: {
    shellMode: true,
    pathname: "/h/srv_1/workspace/wks_86ef0",
    rootRoutes: ["(shell)", "h/[serverId]"],
    rootIndex: 1,
    isCompact: true,
  } satisfies ShellSessionVisibilityInput,
  over: {} as Partial<ShellSessionVisibilityInput>,
}));
vi.mock("@/shell/session-header/visibility-input", () => ({
  useShellSessionVisibilityInput: () => ({ ...edgeRig.base, ...edgeRig.over }),
}));
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
          edgeRig.enabledCalls.push(value);
          return pan;
        },
      };
      return pan;
    },
  },
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("react-native-reanimated", () => ({
  useSharedValue: <T,>(initial: T) => ({ value: initial }),
}));
vi.mock("react-native-worklets", () => ({ scheduleOnRN: () => undefined }));
vi.mock("@/shell/detail-back", () => ({ detailBack: vi.fn() }));

const pathname = vi.mocked(usePathname);

// The detail-column stand-in stamps its mount identity: any remount changes
// the text, so "DETAIL-1 forever" IS the no-remount assertion.
let childMounts = 0;
function CountingChild() {
  const [stamp] = useState(() => `DETAIL-${(childMounts += 1)}`);
  return <Text testID="split-child">{stamp}</Text>;
}

function hostTree() {
  return (
    <ShellTabletSplitHost>
      <CountingChild />
    </ShellTabletSplitHost>
  );
}

function renderHost() {
  return render(hostTree());
}

beforeEach(() => {
  childMounts = 0;
  env.state.compact = false;
  env.state.pending = false;
  env.state.active = true;
  env.state.selectedAgentKey = null;
  pathname.mockReturnValue("/chats");
  vi.mocked(router.navigate).mockClear();
});
afterEach(cleanup);

describe("ShellTabletSplitHost", () => {
  it("renders no rail/column and no split testID when compact (transparent wrappers only)", () => {
    env.state.compact = true;
    const { container } = renderHost();
    expect(screen.queryByTestId("shell-tablet-split")).toBeNull();
    expect(screen.queryByTestId("shell-tablet-rail")).toBeNull();
    // The seam adds a full-size transparent wrapper CHAIN (row → detail slot →
    // C21 edge-back host). Asserted SEMANTICALLY (R2-23): the child is the only
    // content in the passthrough tree. The old depth-chain
    // (`firstElementChild.firstElementChild`) went red for a harmless extra flex
    // wrapper yet stayed green when the slot grew real extra content — counting
    // testID'd nodes catches the latter and ignores the former (the no-remount
    // contract below owns the chain shape). REVIEW-B8-14: the second node is the
    // edge-back host's gesture surface — an always-mounted ancestor of the child.
    expect(container.contains(screen.getByTestId("split-child"))).toBe(true);
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(2);
    // Compact never mounts a list body (the tab screens own them there).
    expect(screen.queryByTestId("body-chats")).toBeNull();
  });

  it("never remounts the children subtree across the split flip (C31-F1)", () => {
    // Rotation = compact↔wide flip with a session open. The pre-C32 host swapped
    // the element type at the children slot → full AppContainer remount → RNGH
    // 2.28 mount-listener race crashed the app (device redscreen). The stable
    // wrapper chain keeps the official tree — and its gesture detectors — alive.
    env.state.compact = true;
    const { rerender } = renderHost();
    expect(screen.getByTestId("split-child").textContent).toBe("DETAIL-1");

    env.state.compact = false; // portrait → landscape
    rerender(hostTree());
    expect(screen.getByTestId("shell-tablet-split")).not.toBeNull();
    expect(screen.getByTestId("split-child").textContent).toBe("DETAIL-1");
    expect(childMounts).toBe(1);

    env.state.compact = true; // landscape → portrait
    rerender(hostTree());
    expect(screen.getByTestId("split-child").textContent).toBe("DETAIL-1");
    expect(childMounts).toBe(1);
  });

  it("passes children through with the shell off and on full-bleed routes", () => {
    env.state.active = false;
    renderHost();
    expect(screen.queryByTestId("shell-tablet-split")).toBeNull();
    cleanup();

    env.state.active = true;
    pathname.mockReturnValue("/welcome");
    renderHost();
    expect(screen.queryByTestId("shell-tablet-split")).toBeNull();
  });

  it("renders rail + the active section body + children when active", () => {
    renderHost();
    expect(screen.getByTestId("shell-tablet-split")).not.toBeNull();
    // Rail: the three destinations, `tabs.*` copy (t is identity under the mock).
    expect(screen.getByTestId("shell-tablet-rail-chats")).not.toBeNull();
    expect(screen.getByTestId("shell-tablet-rail-workspace")).not.toBeNull();
    expect(screen.getByTestId("shell-tablet-rail-me")).not.toBeNull();
    // List column: the chats body is mounted (first visit), the others never were.
    const column = screen.getByTestId("shell-tablet-list-column");
    expect(column).not.toBeNull();
    expect(screen.getByTestId("body-chats")).not.toBeNull();
    expect(screen.queryByTestId("body-workspace")).toBeNull();
    expect(screen.queryByTestId("body-me")).toBeNull();
    // Detail column keeps the children (the official AppContainer subtree).
    expect(screen.getByTestId("split-child")).not.toBeNull();
  });

  it("rail press navigates to the tab; re-press on the live section also emits retap", () => {
    const retapped = vi.fn();
    const off = subscribeRailRetap(retapped);
    renderHost();

    fireEvent.click(screen.getByTestId("shell-tablet-rail-workspace"));
    expect(router.navigate).toHaveBeenCalledWith(SHELL.workspace);
    expect(retapped).not.toHaveBeenCalled(); // not the live section (chats)

    fireEvent.click(screen.getByTestId("shell-tablet-rail-chats"));
    expect(router.navigate).toHaveBeenCalledWith(SHELL.chats);
    expect(retapped).toHaveBeenCalledWith("chats");
    off();
  });

  // R2-03 (FIX-B): on wide the rail press IS a leave action — the session in the
  // detail column is popped/covered. The pending visit must settle with the
  // watermark read at THIS moment, before the section switch runs, so activity
  // that lands afterwards can never be silently marked seen.
  it("rail press settles pending visits before navigating (leave-settles)", () => {
    resetVisitLedger();
    const calls: string[] = [];
    registerVisitLedgerDeps({
      lastEventAtOf: () => {
        calls.push("watermark");
        return 4_242;
      },
      markRead: (key) => {
        calls.push(`markRead:${key}`);
      },
    });
    recordVisit({
      section: "chats",
      key: "srv-1:agent-9",
      serverId: "srv-1",
      agentId: "agent-9",
      at: 100,
    });
    vi.mocked(router.navigate).mockImplementationOnce(() => {
      calls.push("navigate");
    });
    renderHost();
    fireEvent.click(screen.getByTestId("shell-tablet-rail-workspace"));
    expect(calls).toEqual(["watermark", "markRead:srv-1:agent-9", "navigate"]);
    expect(pendingVisits()).toHaveLength(0);
    resetVisitLedger();
  });

  it("keep-alives visited bodies across rail switches (card 裁定 5: body 不重挂)", () => {
    const { rerender } = renderHost();
    expect(screen.getByTestId("body-chats")).not.toBeNull();

    pathname.mockReturnValue("/workspace");
    rerender(hostTree());
    // The workspace body mounts AND the chats body stays mounted (hidden pane) —
    // its scroll position and in-body state survive the switch.
    expect(screen.getByTestId("body-workspace")).not.toBeNull();
    expect(screen.getByTestId("body-chats")).not.toBeNull();
    expect(screen.queryByTestId("body-me")).toBeNull();
  });

  it("feeds the route-derived selection into the bodies (§3.2)", () => {
    env.state.selectedAgentKey = "host:1:a1";
    pathname.mockReturnValue("/h/host%3A1/workspace/w2");
    renderHost();
    // Section memory keeps 对话 live under the session push; the row key flows down.
    expect(screen.getByTestId("body-chats").textContent).toBe("host:1:a1");
  });
});

// REVIEW-B8-14: C21 左缘带兜底的挂载面裁定（卡 09 同款祖先拓扑）。修复前必红：
// 兜底宿主尚不存在时，下面每一条都拿不到 `shell-session-edge-back-host`。
describe("C21 左缘带兜底挂载面（REVIEW-B8-14）", () => {
  beforeEach(() => {
    edgeRig.enabledCalls.length = 0;
    edgeRig.over = {};
    // R2-23: pathname fixtures go through the REAL builders.
    edgeRig.base = {
      ...edgeRig.base,
      pathname: OFFICIAL.workspace("srv_1", "wks_86ef0"),
    };
  });

  it("手势面是会话屏的祖先：中段起滑的触摸 handler 链必经过它", () => {
    env.state.compact = true;
    const { getByTestId } = renderHost();
    const host = getByTestId("shell-session-edge-back-host");
    expect(host.contains(getByTestId("split-child")), "会话屏子树不在手势面内").toBe(true);
  });

  it("split 激活（wide）时同样在位——稳定链契约不因翻转重挂", () => {
    env.state.compact = false;
    const { getByTestId, rerender } = renderHost();
    expect(getByTestId("shell-session-edge-back-host")).not.toBeNull();
    env.state.compact = true;
    rerender(hostTree());
    expect(getByTestId("shell-session-edge-back-host")).not.toBeNull();
    expect(childMounts).toBe(1);
  });

  it("compact 会话屏 = enabled；wide/overlay/非会话路由 = false（纯谓词直通）", () => {
    env.state.compact = true;
    const { rerender } = renderHost();
    expect(edgeRig.enabledCalls.at(-1)).toBe(true);

    edgeRig.over = { isCompact: false };
    rerender(hostTree());
    expect(edgeRig.enabledCalls.at(-1)).toBe(false);

    edgeRig.over = { explorerOverlayOpen: true };
    rerender(hostTree());
    expect(edgeRig.enabledCalls.at(-1)).toBe(false);

    edgeRig.over = { pathname: "/chats" };
    rerender(hostTree());
    expect(edgeRig.enabledCalls.at(-1)).toBe(false);
  });
});
