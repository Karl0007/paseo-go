/**
 * @vitest-environment jsdom
 */
// F20 acceptance: the banner is the topmost in-flow element of (shell)/_layout's
// updateRoot (y=0), so IT owns the status-bar clearance — bar paddingTop must be
// insets.top + spacing[2] (not the bare spacing[2] that overlapped the status bar
// icons on the MatePad frame), while paddingBottom stays spacing[2] and the bar
// keeps pushing the tab area down (in-flow, no absolute positioning). The
// visibility rule itself lives in update/state.test.ts; this file only pins the
// safe-area contract the fix introduces.
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Device-fact stand-in: a MatePad-class status bar. Mutable so one test can also
// prove the zero-inset floor keeps the original padding.
const insets = vi.hoisted(() => ({ current: { top: 47, right: 0, bottom: 0, left: 0 } }));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => insets.current,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo" }));

import { usePaseoGoUpdateNoticeStore } from "@/shell/stores/updateNotice";
import { useShellUpdateStore } from "@/shell/update/state";
import { ShellUpdateBanner } from "@/shell/components/shell-update-banner";

// theme.spacing[2] in both the real theme and the unistyles test stub.
const SPACING_2 = 8;

beforeEach(() => {
  vi.stubGlobal("React", React);
  insets.current = { top: 47, right: 0, bottom: 0, left: 0 };
  useShellUpdateStore.setState({
    phase: "available",
    latest: "0.99.0-go.1",
    url: "https://example.test/releases/tag/v0.99.0-go.1",
  });
  usePaseoGoUpdateNoticeStore.setState({ seenVersion: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShellUpdateBanner safe-area (F20)", () => {
  it("clears the status bar: paddingTop = insets.top + spacing[2]", () => {
    render(<ShellUpdateBanner />);
    expect(screen.getByTestId("shell-update-banner").style.paddingTop).toBe(
      `${insets.current.top + SPACING_2}px`,
    );
  });

  it("keeps the original bottom padding (only the top component yields to the inset)", () => {
    render(<ShellUpdateBanner />);
    expect(screen.getByTestId("shell-update-banner").style.paddingBottom).toBe(`${SPACING_2}px`);
  });

  it("zero inset falls back to the bare spacing[2] top padding", () => {
    insets.current = { top: 0, right: 0, bottom: 0, left: 0 };
    render(<ShellUpdateBanner />);
    expect(screen.getByTestId("shell-update-banner").style.paddingTop).toBe(`${SPACING_2}px`);
  });

  it("stays in flow (static position) so the tab area is still flexed down", () => {
    render(<ShellUpdateBanner />);
    expect(screen.getByTestId("shell-update-banner").style.position).not.toBe("absolute");
  });

  it("renders nothing once the version is seen — no phantom inset strip", () => {
    usePaseoGoUpdateNoticeStore.setState({ seenVersion: "0.99.0-go.1" });
    render(<ShellUpdateBanner />);
    expect(screen.queryByTestId("shell-update-banner")).toBeNull();
  });
});
