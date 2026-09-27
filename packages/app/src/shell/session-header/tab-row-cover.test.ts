// R2-08③ regression: the capsule bar's tab-row cover must keep tracking the
// official rows it paints out. Two halves:
//  1. the pure height maths (compact = token-derived trigger height × fontScale
//     ceiling; wide native = the fixed secondary-header height; wide web = none);
//  2. the FIX-C source-pair gate (R2-11 posture): parse the official sources and
//     pin the formula's inputs — paddings/sizes/heights and the fact that both
//     close-tab rows still render directly under the official header. Upstream
//     drift reddens this suite instead of silently re-opening the 关 tab 归档 entry.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { BORDER_WIDTH, FONT_SIZE, ICON_SIZE, SPACING } from "@/styles/theme";
import {
  COMPACT_SLIVER_REDUNDANCY_DP,
  TEXT_LINE_HEIGHT_CEILING,
  tabRowCoverHeightDp,
} from "./tab-row-cover";

const TOKENS = {
  triggerPaddingDp: SPACING[2],
  triggerFontSizeDp: FONT_SIZE.base,
  triggerIconDp: ICON_SIZE.sm,
  borderWidthDp: BORDER_WIDTH[1],
  secondaryHeaderHeightDp: WORKSPACE_SECONDARY_HEADER_HEIGHT,
};

function cover(overrides: Partial<Parameters<typeof tabRowCoverHeightDp>[0]> = {}) {
  return tabRowCoverHeightDp({
    isCompact: true,
    fontScale: 1,
    desktopSplits: false,
    ...TOKENS,
    ...overrides,
  });
}

describe("tabRowCoverHeightDp (胶囊盖高)", () => {
  it("compact: paddings + max(icon, ceiling'd text line) + border + 4dp sliver redundancy", () => {
    expect(cover()).toBe(
      SPACING[2] * 2 +
        Math.ceil(FONT_SIZE.base * TEXT_LINE_HEIGHT_CEILING) +
        BORDER_WIDTH[1] +
        COMPACT_SLIVER_REDUNDANCY_DP,
    );
  });

  // CLOSE-DEV4 g6-01..06 (portrait, density 400): the official tab row rendered
  // [220,312] (92px) while the shell bar's bottom edge sat at y=308 — the row's
  // TOP lands ~4px below the token maths (RN per-node integer rounding), so the
  // 37dp=92.5px cover left a 4px tappable sliver: taps at (800,309)/(800,311)
  // opened the 切换标签 sheet → 关 tab→归档 stayed reachable. The cover must stay
  // ≥ the token-derived row bottom + the measured rounding slack.
  it("compact: cover ≥ token row bottom + 4dp device sliver (CLOSE-DEV4 g6-05/06)", () => {
    const tokenRowHeight =
      SPACING[2] * 2 + Math.ceil(FONT_SIZE.base * TEXT_LINE_HEIGHT_CEILING) + BORDER_WIDTH[1];
    expect(cover()).toBeGreaterThanOrEqual(tokenRowHeight + COMPACT_SLIVER_REDUNDANCY_DP);
    expect(COMPACT_SLIVER_REDUNDANCY_DP).toBe(4);
  });

  it("compact: Android fontScale inflates the cover with the row", () => {
    for (const fontScale of [1.15, 1.3, 2]) {
      expect(cover({ fontScale })).toBe(
        SPACING[2] * 2 +
          Math.ceil(FONT_SIZE.base * fontScale * TEXT_LINE_HEIGHT_CEILING) +
          BORDER_WIDTH[1] +
          COMPACT_SLIVER_REDUNDANCY_DP,
      );
    }
    // A sub-1 scale never shrinks below the icon floor.
    expect(cover({ fontScale: 0.5 })).toBe(cover());
  });

  it("wide native = the fixed desktop-row height; wide web = no cover", () => {
    expect(cover({ isCompact: false })).toBe(WORKSPACE_SECONDARY_HEADER_HEIGHT + BORDER_WIDTH[1]);
    expect(cover({ isCompact: false, desktopSplits: true })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 对拍闸 (source-pair): the formula inputs live in official files. Same posture
// as shell/tablet/form-factor.test.ts — parse, don't import (booting the screen
// module in node is impossible).
// ---------------------------------------------------------------------------
function officialSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const screenSource = officialSource("../../screens/workspace/workspace-screen.tsx");
const desktopRowSource = officialSource("../../screens/workspace/workspace-desktop-tabs-row.tsx");

describe("official tab-row shape pin (R2-08③ drift gate)", () => {
  it("the mobile switcher trigger still pads on spacing[2] and texts on fontSize.base", () => {
    const trigger = screenSource.match(/switcherTrigger:\s*\{([^}]*)\}/u)?.[1] ?? "";
    expect(trigger).toContain("paddingVertical: theme.spacing[2]");
    const label = screenSource.match(/switcherTriggerText:\s*\{([^}]*)\}/u)?.[1] ?? "";
    expect(label).toContain("fontSize: theme.fontSize.base");
    const row = screenSource.match(/mobileTabsRow:\s*\{([^}]*)\}/u)?.[1] ?? "";
    expect(row).toContain("borderBottomWidth: theme.borderWidth[1]");
  });

  it("the trigger icon keeps its fixed 14dp floor (WorkspaceTabIcon default)", () => {
    const signature =
      screenSource.match(
        /export function WorkspaceTabIcon\(\{[\s\S]{0,200}?size\s*=\s*(\d+)/u,
      )?.[1] ??
      officialSource("../../screens/workspace/workspace-tab-presentation.tsx").match(
        /export function WorkspaceTabIcon\(\{[\s\S]{0,200}?size\s*=\s*(\d+)/u,
      )?.[1];
    expect(Number(signature)).toBe(ICON_SIZE.sm);
  });
  it("the mobile row still renders directly under the official header (cover span holds)", () => {
    const headerAt = screenSource.indexOf(
      "{rendersDesktopSplitContent ? null : renderWorkspaceScreenHeader()}",
    );
    const rowAt = screenSource.indexOf("<MobileWorkspaceTabSwitcher");
    // The centerContent View exists in several shells — the one that matters is
    // the LAST (workspaceCenterColumn's), the sibling right below the row.
    const contentAt = screenSource.lastIndexOf("<View style={styles.centerContent}>");
    expect(headerAt).toBeGreaterThan(-1);
    expect(rowAt).toBeGreaterThan(headerAt);
    expect(contentAt).toBeGreaterThan(rowAt);
    expect(screenSource).toContain('testID="workspace-tabs-row"');
    // …and it is still the close-tab entry the cover must keep unreachable.
    expect(screenSource).toContain("onCloseTab={handleCloseTabById}");
  });

  it("the desktop fallback row keeps its fixed height + 1px border", () => {
    expect(desktopRowSource).toContain("height: WORKSPACE_SECONDARY_HEADER_HEIGHT");
    expect(desktopRowSource).toContain("onCloseTab");
  });
});
