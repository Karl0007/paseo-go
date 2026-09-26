// @vitest-environment jsdom
// C30 acceptance 2: the hook-level activation gate — seam pending (R-2/KI3),
// compact, shell-off and full-bleed all hold the passthrough; the section
// memory across `/h/…`-style pushes is the §3.2-2 "宿主 ref 记忆" behaviour.
import { renderHook } from "@testing-library/react";
import { useTabletSplit } from "./use-tablet-split";
import { usePathname } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  breakpoint: "lg" as string | undefined,
  seam: { pending: false, active: true },
}));

// Full replacement (not importOriginal+spread): vitest's alias to the unistyles
// test double does not apply to importOriginal, and the hook's graph only needs
// useUnistyles (constants/layout subscribes through it).
vi.mock("react-native-unistyles", () => ({
  useUnistyles: () => ({
    theme: { colors: { accent: "#2563eb", foregroundMuted: "#666666" } },
    rt: { breakpoint: env.breakpoint },
  }),
}));
vi.mock("@/shell/use-shell-seam", () => ({ useShellSeam: () => env.seam }));

const pathname = vi.mocked(usePathname);

beforeEach(() => {
  env.breakpoint = "lg";
  env.seam.pending = false;
  env.seam.active = true;
  pathname.mockReturnValue("/chats");
});

describe("useTabletSplit", () => {
  it("activates on wide + shell + a tab route", () => {
    const { result } = renderHook(() => useTabletSplit());
    expect(result.current).toEqual({ active: true, section: "chats" });
  });

  it.each(["xs", "sm"] as const)("passes through at the compact breakpoint %s", (bp) => {
    env.breakpoint = bp;
    const { result } = renderHook(() => useTabletSplit());
    expect(result.current.active).toBe(false);
  });

  it("passes through with the shell off (official IA untouched)", () => {
    env.seam.active = false;
    const { result } = renderHook(() => useTabletSplit());
    expect(result.current.active).toBe(false);
  });

  it("holds passthrough while the seam is pending (R-2 cold-landscape gate)", () => {
    env.seam.pending = true;
    const { result, rerender } = renderHook(() => useTabletSplit());
    expect(result.current.active).toBe(false);
    env.seam.pending = false;
    rerender();
    expect(result.current.active).toBe(true);
  });

  it.each(["/welcome", "/pair-scan"])("keeps %s full-window", (route) => {
    pathname.mockReturnValue(route);
    const { result } = renderHook(() => useTabletSplit());
    expect(result.current.active).toBe(false);
  });

  it("remembers the section across session/files pushes", () => {
    pathname.mockReturnValue("/workspace");
    const { result, rerender } = renderHook(() => useTabletSplit());
    expect(result.current).toMatchObject({ active: true, section: "workspace" });

    // Session push: the official route embeds `/workspace/` mid-path (§3.1-3).
    pathname.mockReturnValue("/h/host%3A1/workspace/w2?open=agent:a1");
    rerender();
    expect(result.current).toMatchObject({ active: true, section: "workspace" });

    pathname.mockReturnValue("/me");
    rerender();
    expect(result.current.section).toBe("me");

    pathname.mockReturnValue("/files/host%3A1/w2");
    rerender();
    expect(result.current.section).toBe("workspace");

    pathname.mockReturnValue("/h/host%3A1/workspace/w2");
    rerender();
    expect(result.current.section).toBe("workspace");
  });
});
