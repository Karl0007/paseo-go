// R2-04 (拍板 2a) regression: the OFFICIAL compact form factor must resolve from
// the RN-core window-dimensions subscription. Device evidence C31-F1: Unistyles'
// `rt.breakpoint` never updates on a runtime rotation (Fabric re-layouts natively,
// the JS subscription stays silent) — every useIsCompactFormFactor consumer kept
// stale chrome mid-session. Baseline read rt.breakpoint (this suite fails on it:
// the mocked window width changes nothing / the unistyles runtime is not booted);
// the fixed hook follows useWindowDimensions in both directions.
// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const dimensions = vi.hoisted(() => ({ width: 375 }));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useWindowDimensions: () => dimensions };
});

import { useIsCompactFormFactor } from "@/constants/layout";

describe("useIsCompactFormFactor (window-width source)", () => {
  it.each([
    // 三档宽: phone portrait 375 / MatePad portrait 640 (sm) / landscape 1024 (lg),
    // plus the md floor itself — compact is width < 720, md starts AT 720.
    [375, true],
    [640, true],
    [719, true],
    [720, false],
    [1024, false],
  ])("width %idp → compact=%s", (width, compact) => {
    dimensions.width = width;
    const { result } = renderHook(() => useIsCompactFormFactor());
    expect(result.current).toBe(compact);
  });

  it("a live rotation flips the verdict on re-render (no stale face)", () => {
    dimensions.width = 375;
    const { result, rerender } = renderHook(() => useIsCompactFormFactor());
    expect(result.current).toBe(true);
    dimensions.width = 1024;
    rerender();
    expect(result.current).toBe(false);
    dimensions.width = 375;
    rerender();
    expect(result.current).toBe(true);
  });
});
