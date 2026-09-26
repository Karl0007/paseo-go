// @vitest-environment jsdom
// C30 acceptance 2 (passthrough half): the host is the §6 "byte-identical tree"
// claim — inactive returns `children` with no wrapper element at all; active
// renders [rail | list placeholder | children] and the rail drives navigation
// (§4-3) plus the §4-8 retap stub.
import React from "react";
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
      surface0: "#ffffff",
      surface1: "#fafafa",
      border: "#e4e4e7",
    },
    spacing: [0, 4, 8, 12, 16, 20, 24, 28, 32],
    fontSize: { xs: 12, sm: 14, base: 16, lg: 18 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    borderWidth: { 1: 1 },
    borderRadius: { base: 4, md: 6, lg: 8, xl: 12, full: 9999 },
  };
  const state = {
    breakpoint: "lg" as string | undefined,
    pending: false,
    active: true,
  };
  return {
    state,
    StyleSheet: {
      create: (styles: unknown) =>
        typeof styles === "function" ? (styles as (t: typeof theme) => unknown)(theme) : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    useUnistyles: () => ({ theme, rt: { breakpoint: state.breakpoint } }),
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: env.StyleSheet,
  withUnistyles: env.withUnistyles,
  useUnistyles: env.useUnistyles,
}));
vi.mock("@/shell/use-shell-seam", () => ({
  useShellSeam: () => ({ pending: env.state.pending, active: env.state.active }),
}));
vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo", ensureShellI18n: () => {} }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const pathname = vi.mocked(usePathname);

function renderHost() {
  return render(
    <ShellTabletSplitHost>
      <Text testID="split-child">DETAIL-COLUMN</Text>
    </ShellTabletSplitHost>,
  );
}

beforeEach(() => {
  env.state.breakpoint = "lg";
  env.state.pending = false;
  env.state.active = true;
  pathname.mockReturnValue("/chats");
  vi.mocked(router.navigate).mockClear();
});
afterEach(cleanup);

describe("ShellTabletSplitHost", () => {
  it("passes children through with NO wrapper when compact", () => {
    env.state.breakpoint = "sm";
    const { container } = renderHost();
    expect(screen.queryByTestId("shell-tablet-split")).toBeNull();
    expect(screen.queryByTestId("shell-tablet-rail")).toBeNull();
    // The child IS the container's root — the seam adds no element.
    expect(container.firstElementChild).toBe(screen.getByTestId("split-child"));
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

  it("renders rail + list placeholder + children when active", () => {
    renderHost();
    expect(screen.getByTestId("shell-tablet-split")).not.toBeNull();
    // Rail: the three destinations, `tabs.*` copy (t is identity under the mock).
    expect(screen.getByTestId("shell-tablet-rail-chats")).not.toBeNull();
    expect(screen.getByTestId("shell-tablet-rail-workspace")).not.toBeNull();
    expect(screen.getByTestId("shell-tablet-rail-me")).not.toBeNull();
    // List column placeholder: active section title + empty state (§ card scope).
    const column = screen.getByTestId("shell-tablet-list-column");
    expect(column.textContent).toContain("tabs.chats");
    expect(screen.getByTestId("shell-tablet-list-placeholder")).not.toBeNull();
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
});
