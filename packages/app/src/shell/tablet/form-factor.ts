// C32 (增补裁定 5, C31-F1): the window-width form factor the split + its column
// widths + the session-header compact branches ALL share. C31 device evidence:
// Unistyles `rt.breakpoint` does not update on a runtime portrait→landscape
// rotation (Fabric re-layouts natively, the JS breakpoint subscription never
// fires), so the official `useIsCompactFormFactor()` face goes stale mid-session
// — split activation, rail/list widths and the compact-only edge band must not
// key off it. `useWindowDimensions()` is the RN-core subscription (Dimensions
// change event), which rotates in both directions; these hooks are the ONLY
// form-factor source inside the tablet split (DESIGN-tablet §2 matrix).
//
// Thresholds mirror the Unistyles breakpoint table (styles/unistyles.ts:6-12) as
// data: compact = xs|sm = width < md's 720 floor; the lg column set starts at
// lg's 992 floor (xl inherits lg, metrics.ts). Keeping them here as pure
// functions is what lets the unit tests pin the rotation thresholds
// (form-factor.test.ts) — the hook bodies are three lines of glue.
import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { TABLET_LIST_WIDTH, TABLET_RAIL_WIDTH } from "./metrics";

/** md floor: a window narrower than this stays the compact phone/tab shell. */
export const TABLET_SPLIT_MIN_WIDTH_DP = 720;
/** lg floor: from here the rail/list take the wider (standard) column set. */
export const TABLET_LARGE_MIN_WIDTH_DP = 992;

/** Width → compact verdict (the §2 matrix row selector; rotation-pure). */
export function isCompactWindowWidth(widthDp: number): boolean {
  return widthDp < TABLET_SPLIT_MIN_WIDTH_DP;
}

export interface TabletColumnWidths {
  rail: number;
  list: number;
}

/** Width → the §4-5 rail/list pixel pair (md set below lg, lg set from lg up). */
export function tabletColumnsForWidth(widthDp: number): TabletColumnWidths {
  return widthDp >= TABLET_LARGE_MIN_WIDTH_DP
    ? { rail: TABLET_RAIL_WIDTH.lg, list: TABLET_LIST_WIDTH.lg }
    : { rail: TABLET_RAIL_WIDTH.md, list: TABLET_LIST_WIDTH.md };
}

/** Live compact flag from the window dimensions (NOT the Unistyles breakpoint). */
export function useShellWindowCompact(): boolean {
  const { width } = useWindowDimensions();
  return isCompactWindowWidth(width);
}

/** Live rail/list widths, same source as `useShellWindowCompact` — activation
 * and geometry flip in the SAME frame, no half-updated split (C31-F1). */
export function useTabletColumns(): TabletColumnWidths {
  const { width } = useWindowDimensions();
  return useMemo(() => tabletColumnsForWidth(width), [width]);
}
