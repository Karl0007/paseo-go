// R2-08③: 壳内官方 tab 行不可达化 — the session-header capsule already paints the
// official compact header out (C21); the tab rows sitting directly beneath it are
// the ONLY in-shell entry to the close-tab → root-agent archive semantics
// (close-tab-policy.ts archive-on-close; C24 真机误触实锤). This module sizes the
// bar's extension so its opaque surface0 span also covers that row: the trigger
// becomes untappable, 关 tab 归档 unreachable inside the shell session screen —
// decisions #1 选项 a, zero new upstream touchpoints.
//
// The heights are the official styles' token maths, MACHINE-PINNED by
// tab-row-cover.test.ts (FIX-C R2-11 source-parse posture): the mobile row is
// switcherTrigger paddingVertical×2 + max(14dp icon, label line) + the row's
// bottom border; the native-wide fallback row is the fixed
// WORKSPACE_SECONDARY_HEADER_HEIGHT + its 1px border; web-wide renders the split's
// own pane tab rows (outside the capsule's span) → no cover.
//
// The mobile label line is the only non-fixed term: RN text height grows with
// Android's fontScale, so the cover tracks it with a 1.2 line-height ceiling
// (Roboto ≈1.172, SF ≈1.195 — ceil keeps the cover ≥ the real row). Over-cover
// eats ≤~1dp of the session top at scale 1; under-cover would leave a tappable
// sliver — the safe direction is over.
//
// FixB4 (CLOSE-DEV4 g6-01..06, portrait density 400): the token maths alone still
// UNDER-covered the real row — the official tab row rendered [220,312] (92px)
// while the bar's bottom edge sat at y=308, i.e. the row's top edge lands ~4px
// BELOW the token maths (RN per-node integer rounding). The 37dp=92.5px cover
// left a 4px sliver at the bar bottom; taps at (800,309)/(800,311) still opened
// the 切换标签 sheet → 关 tab→归档 remained reachable in portrait. The compact
// branch therefore carries COMPACT_SLIVER_REDUNDANCY_DP of over-cover slack;
// the native-wide branch renders the fixed-height row and needs none.

/** RN text line-height ceiling the mobile cover tracks (header, fontScale maths). */
export const TEXT_LINE_HEIGHT_CEILING = 1.2;

/** Measured portrait rounding slack the token maths misses (header, FixB4). */
export const COMPACT_SLIVER_REDUNDANCY_DP = 4;

export interface TabRowCoverInput {
  /** The capsule's compact flag (window-width source, C32 增补裁定 5). */
  isCompact: boolean;
  /** theme.spacing[2] — switcherTrigger paddingVertical (each side). */
  triggerPaddingDp: number;
  /** theme.fontSize.base — the trigger label size. */
  triggerFontSizeDp: number;
  /** theme.iconSize.sm — WorkspaceTabIcon's fixed 14dp default. */
  triggerIconDp: number;
  /** theme.borderWidth[1] — the row's bottom border. */
  borderWidthDp: number;
  /** WORKSPACE_SECONDARY_HEADER_HEIGHT — the native-wide row's fixed height. */
  secondaryHeaderHeightDp: number;
  /** Android text scale (caller pins iOS/web to 1 — RN iOS text does not scale). */
  fontScale: number;
  /** supportsDesktopPaneSplits() — web renders the split's own rows instead. */
  desktopSplits: boolean;
}

export function tabRowCoverHeightDp(input: TabRowCoverInput): number {
  if (!input.isCompact) {
    return input.desktopSplits ? 0 : input.secondaryHeaderHeightDp + input.borderWidthDp;
  }
  const textHeight = Math.ceil(
    input.triggerFontSizeDp * Math.max(1, input.fontScale) * TEXT_LINE_HEIGHT_CEILING,
  );
  const tokenRowHeight =
    input.triggerPaddingDp * 2 + Math.max(input.triggerIconDp, textHeight) + input.borderWidthDp;
  return tokenRowHeight + COMPACT_SLIVER_REDUNDANCY_DP;
}
