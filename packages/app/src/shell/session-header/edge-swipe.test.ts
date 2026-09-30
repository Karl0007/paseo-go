// C21 acceptance: the edge-back direction lock. The band sits over the session,
// so every wrong activation is a navigation the user did not ask for and every
// wrong fail is a dead swipe: this pins the threshold set (rightward commit at
// SHELL_EDGE_BACK_ACTIVATE_DP, vertical/leftward escape at 10dp, the diagonal
// tie-break) and the band width the card ruled.
import { describe, expect, it } from "vitest";
import {
  isInsideShellEdgeBand,
  resolveShellEdgeSwipeIntent,
  SHELL_EDGE_BACK_ACTIVATE_DP,
  SHELL_EDGE_BAND_WIDTH_DP,
} from "./edge-swipe";

describe("resolveShellEdgeSwipeIntent", () => {
  it("keeps the card's geometry: ≈32dp band, horizontal commit threshold inside it", () => {
    expect(SHELL_EDGE_BAND_WIDTH_DP).toBe(32);
    // 卡面定稿=24dp 右移行程；`toBeGreaterThan(0)` 对任何正值恒真（R2-23 假绿
    // 修复）——阈值漂到 20 或 30 时这条必须红，而不是只靠下面的行为矩阵兜底。
    expect(SHELL_EDGE_BACK_ACTIVATE_DP).toBe(24);
    expect(SHELL_EDGE_BACK_ACTIVATE_DP).toBeLessThanOrEqual(SHELL_EDGE_BAND_WIDTH_DP);
  });

  it("waits below the commit threshold and on a still-undecided drag", () => {
    expect(resolveShellEdgeSwipeIntent({ deltaX: 0, deltaY: 0 })).toBe("wait");
    expect(resolveShellEdgeSwipeIntent({ deltaX: 5, deltaY: 0 })).toBe("wait");
    expect(
      resolveShellEdgeSwipeIntent({ deltaX: SHELL_EDGE_BACK_ACTIVATE_DP - 1, deltaY: 0 }),
    ).toBe("wait");
    expect(resolveShellEdgeSwipeIntent({ deltaX: 8, deltaY: 9 })).toBe("wait");
  });

  it("commits 返回 on a rightward drag past the threshold with horizontal dominance", () => {
    expect(resolveShellEdgeSwipeIntent({ deltaX: SHELL_EDGE_BACK_ACTIVATE_DP, deltaY: 0 })).toBe(
      "back",
    );
    expect(resolveShellEdgeSwipeIntent({ deltaX: 120, deltaY: 40 })).toBe("back");
    // Exact diagonal tie goes to the horizontal lock (the swipe's axis).
    expect(resolveShellEdgeSwipeIntent({ deltaX: 30, deltaY: 30 })).toBe("back");
  });

  it("fails vertical drags to the session's scroll views", () => {
    expect(resolveShellEdgeSwipeIntent({ deltaX: 0, deltaY: 60 })).toBe("fail");
    expect(resolveShellEdgeSwipeIntent({ deltaX: 12, deltaY: 40 })).toBe("fail");
    expect(resolveShellEdgeSwipeIntent({ deltaX: 100, deltaY: 101 })).toBe("fail");
  });

  it("fails leftward drags — that is the explorer-close direction, never a back", () => {
    expect(resolveShellEdgeSwipeIntent({ deltaX: -10, deltaY: 0 })).toBe("fail");
    expect(resolveShellEdgeSwipeIntent({ deltaX: -200, deltaY: 5 })).toBe("fail");
    // Small leftward jitter stays undecided until an axis wins.
    expect(resolveShellEdgeSwipeIntent({ deltaX: -9, deltaY: 0 })).toBe("wait");
  });

  it("a short vertical nudge (≤10dp) does not fail a later horizontal commit", () => {
    // Thumb drags are never perfectly flat: 6dp of vertical noise on the way
    // to the threshold must still land 返回.
    expect(resolveShellEdgeSwipeIntent({ deltaX: SHELL_EDGE_BACK_ACTIVATE_DP, deltaY: 6 })).toBe(
      "back",
    );
  });
});

describe("isInsideShellEdgeBand", () => {
  it("keeps the band at the ruled 32dp and nothing wider", () => {
    expect(isInsideShellEdgeBand(0)).toBe(true);
    expect(isInsideShellEdgeBand(SHELL_EDGE_BAND_WIDTH_DP)).toBe(true);
    expect(isInsideShellEdgeBand(SHELL_EDGE_BAND_WIDTH_DP + 0.5)).toBe(false);
  });

  it("compares dp against dp — a density-scaled band is the bug this replaces", () => {
    // The gate runs against RNGH's `absoluteX`, which Android already converts
    // to dp (`PixelUtil.toDIPFromPixel`) and iOS reports in points. Multiplying
    // the band by `PixelRatio.get()` compared 80 against a dp coordinate, so on
    // a 2.5-density device any right-drag starting within 80dp of the left edge
    // was stolen from the session underneath.
    const density = 2.5;
    expect(isInsideShellEdgeBand(SHELL_EDGE_BAND_WIDTH_DP * density)).toBe(false);
    // The real edge touch: 80 raw px on a 2.5-density screen arrives as 32dp.
    expect(isInsideShellEdgeBand(80 / density)).toBe(true);
  });
});
