// C32 增补裁定 5 acceptance: the window-width → compact/split thresholds are
// pinned as data. This is the C31-F1 contract: activation and the column set key
// off `useWindowDimensions()` alone, so these two boundaries — and ONLY these —
// decide when a rotating window splits and when it swaps the md→lg column pair.
// The floors must stay identical to the Unistyles breakpoint table
// (styles/unistyles.ts:6-12), otherwise the split and every breakpoint-keyed
// official style disagree mid-rotation.
import { describe, expect, it } from "vitest";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { TABLET_DETAIL_CONTENT_MAX_WIDTH } from "./metrics";
import {
  isCompactWindowWidth,
  TABLET_LARGE_MIN_WIDTH_DP,
  TABLET_SPLIT_MIN_WIDTH_DP,
  tabletColumnsForWidth,
} from "./form-factor";

describe("isCompactWindowWidth (window → compact/split threshold)", () => {
  it("keeps the §2 matrix boundaries at the Unistyles md/lg floors", () => {
    expect(TABLET_SPLIT_MIN_WIDTH_DP).toBe(720);
    expect(TABLET_LARGE_MIN_WIDTH_DP).toBe(992);
  });

  it.each([
    // MatePad portrait is exactly 640dp (sm); half-split 512dp (xs).
    [512, true],
    [575, true],
    [576, true],
    [640, true],
    [719, true],
    // md starts AT 720 — the split activates on the floor, not above it.
    [720, false],
    [991, false],
    // MatePad landscape 1024dp (lg) and xl windows are wide.
    [992, false],
    [1024, false],
    [1600, false],
  ])("width %idp → compact=%s", (width, compact) => {
    expect(isCompactWindowWidth(width)).toBe(compact);
  });
});

describe("tabletColumnsForWidth (window → rail/list pair)", () => {
  it("takes the md set across the whole narrow split band 720–991", () => {
    for (const width of [720, 800, 991]) {
      expect(tabletColumnsForWidth(width)).toEqual({ rail: 56, list: 260 });
    }
  });

  it("takes the lg set from 992 up (xl inherits lg)", () => {
    for (const width of [992, 1024, 1200, 2560]) {
      expect(tabletColumnsForWidth(width)).toEqual({ rail: 64, list: 300 });
    }
  });

  it("leaves the detail column at or above its floor at both band edges", () => {
    // The §4-5 math re-checked against the SAME source the split uses:
    // md floor window 720−56−260=404 ≥ 400; lg MatePad 1024−64−300=660.
    expect(720 - tabletColumnsForWidth(720).rail - tabletColumnsForWidth(720).list).toBe(404);
    expect(1024 - tabletColumnsForWidth(1024).rail - tabletColumnsForWidth(1024).list).toBe(660);
  });

  it("centers session content at the official max width (§4-5, C32 consumption)", () => {
    expect(TABLET_DETAIL_CONTENT_MAX_WIDTH).toBe(MAX_CONTENT_WIDTH);
    expect(TABLET_DETAIL_CONTENT_MAX_WIDTH).toBe(820);
  });
});
