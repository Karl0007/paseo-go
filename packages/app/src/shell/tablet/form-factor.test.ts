// C32 增补裁定 5 acceptance: the window-width → compact/split thresholds are
// pinned as data. This is the C31-F1 contract: activation and the column set key
// off `useWindowDimensions()` alone, so these two boundaries — and ONLY these —
// decide when a rotating window splits and when it swaps the md→lg column pair.
// The floors must stay identical to the Unistyles breakpoint table, otherwise
// the split and every breakpoint-keyed official style disagree mid-rotation —
// enforced by the source-pair gate at the bottom (R2-11), not by the literals.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { TABLET_DETAIL_CONTENT_MAX_WIDTH } from "./metrics";
import {
  isCompactWindowWidth,
  TABLET_LARGE_MIN_WIDTH_DP,
  TABLET_SPLIT_MIN_WIDTH_DP,
  tabletColumnsForWidth,
} from "./form-factor";

// R2-11 对拍闸: the Unistyles breakpoint table (styles/unistyles.ts) is the REAL
// source every breakpoint-keyed official style resolves against, but it is NOT
// exported (StyleSheet.configure takes it inline) and importing that module would
// boot the unistyles runtime in the node test env — so a normal import-based pair
// test is unwritable. The gate therefore parses the SOURCE TEXT and pins the two
// mirror floors to md/lg. Upstream moving md or lg now reddens this suite instead
// of silently desyncing the split from the styles (the old `toBe(720)/toBe(992)`
// only re-pinned this module's own literals — self-referential, R2-23 family).
// known_issue (R2-11, ledger): the shell reads `useWindowDimensions()` (window
// width) while Unistyles resolves `rt.breakpoint` from its own subscription; the
// two faces only diverge under Android ≤10 free-form multi-window (window ≠
// screen), where the Unistyles face is ALSO stale mid-rotation (C31-F1). The
// window-width face is the deliberately chosen, rotation-correct one — accepted.
function unistylesBreakpoint(name: "md" | "lg"): number {
  const src = readFileSync(
    fileURLToPath(new URL("../../styles/unistyles.ts", import.meta.url)),
    "utf8",
  );
  const table = src.match(/breakpoints:\s*\{([^}]*)\}/)?.[1] ?? "";
  const value = Number(table.match(new RegExp(`\\b${name}:\\s*(\\d+)`))?.[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`breakpoints.${name} not found in styles/unistyles.ts — table shape changed`);
  }
  return value;
}

describe("Unistyles breakpoint mirror (R2-11 source-pair gate)", () => {
  it("keeps the split floor on the table's md breakpoint", () => {
    expect(unistylesBreakpoint("md")).toBe(720); // guard the regex itself
    expect(TABLET_SPLIT_MIN_WIDTH_DP).toBe(unistylesBreakpoint("md"));
  });

  it("keeps the large floor on the table's lg breakpoint", () => {
    expect(unistylesBreakpoint("lg")).toBe(992); // guard the regex itself
    expect(TABLET_LARGE_MIN_WIDTH_DP).toBe(unistylesBreakpoint("lg"));
  });

  // R2-04 (2a) extended the mirror to the OFFICIAL face: constants/layout.ts
  // re-implements the compact verdict on useWindowDimensions with the md floor
  // INLINED (official files cannot import this shell module). If upstream moves
  // md — or the fork edits the literal — the official hook and the split would
  // disagree mid-frame again, so the literal is pinned to the table by source
  // parse (importing layout.ts here would boot react-native's hook for nothing;
  // compact-form-factor.test.tsx owns the behavioural side).
  it("pins the official useIsCompactFormFactor threshold to the same md floor", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../constants/layout.ts", import.meta.url)),
      "utf8",
    );
    const value = Number(src.match(/COMPACT_FORM_FACTOR_MAX_WIDTH\s*=\s*(\d+)/u)?.[1]);
    expect(value).toBe(unistylesBreakpoint("md"));
    expect(value).toBe(TABLET_SPLIT_MIN_WIDTH_DP);
    // The hook must keep reading the rotation-correct subscription (C31-F1).
    expect(src).toContain("useWindowDimensions()");
  });
});

describe("isCompactWindowWidth (window → compact/split threshold)", () => {
  it("keeps the §2 matrix boundaries at the current md/lg floors", () => {
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
