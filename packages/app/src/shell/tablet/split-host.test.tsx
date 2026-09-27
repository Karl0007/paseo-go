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
import { SHELL } from "@/shell/routes";
import { subscribeRailRetap } from "./rail-events";
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
vi.mock("./use-tablet-selection", () => ({
  useTabletSelectedAgentKey: () => env.state.selectedAgentKey,
}));

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
    // The seam adds a full-size transparent wrapper CHAIN (row → detail slot).
    // Asserted SEMANTICALLY (R2-23): the child is the only content in the
    // passthrough tree. The old depth-chain (`firstElementChild.firstElementChild`)
    // went red for a harmless extra flex wrapper yet stayed green when the slot
    // grew real extra content — counting testID'd nodes catches the latter and
    // ignores the former (the no-remount contract below owns the chain shape).
    expect(container.contains(screen.getByTestId("split-child"))).toBe(true);
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(1);
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
