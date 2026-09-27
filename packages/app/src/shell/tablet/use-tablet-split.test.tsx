// @vitest-environment jsdom
// C30 acceptance 2: the hook-level activation gate — seam pending (R-2/KI3),
// compact, shell-off and full-bleed all hold the passthrough; the section
// memory across `/h/…`-style pushes is the §3.2-2 "宿主 ref 记忆" behaviour.
// C32 (C31-F1): the compact signal is the window-dimension hook (form-factor),
// not the Unistyles breakpoint — the width→compact threshold itself is pinned
// in form-factor.test.ts; here the hook is driven directly, which is also the
// rotation itself (compact flips without any breakpoint machinery in the graph).
import { renderHook } from "@testing-library/react";
import { usePathname } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabletSplit } from "./use-tablet-split";

const env = vi.hoisted(() => ({
  compact: false,
  seam: { pending: false, active: true },
}));

// The activation source is mocked at the hook seam — form-factor's own pure
// thresholds are unit-pinned separately (form-factor.test.ts).
vi.mock("./form-factor", () => ({
  useShellWindowCompact: () => env.compact,
}));
vi.mock("@/shell/use-shell-seam", () => ({ useShellSeam: () => env.seam }));

const pathname = vi.mocked(usePathname);

beforeEach(() => {
  env.compact = false;
  env.seam.pending = false;
  env.seam.active = true;
  pathname.mockReturnValue("/chats");
});

describe("useTabletSplit", () => {
  it("activates on wide + shell + a tab route", () => {
    const { result } = renderHook(() => useTabletSplit());
    expect(result.current).toEqual({ active: true, section: "chats" });
  });

  it("passes through while the window is compact (portrait / half-split)", () => {
    env.compact = true;
    const { result } = renderHook(() => useTabletSplit());
    expect(result.current.active).toBe(false);
  });

  it("flips the split on with the window on every rotation (C31-F1)", () => {
    const { result, rerender } = renderHook(() => useTabletSplit());
    expect(result.current.active).toBe(true);
    env.compact = true; // portrait
    rerender();
    expect(result.current.active).toBe(false);
    env.compact = false; // landscape — the frame Unistyles never delivered
    rerender();
    expect(result.current.active).toBe(true);
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
