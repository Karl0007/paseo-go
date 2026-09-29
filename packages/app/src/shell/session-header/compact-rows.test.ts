// KI-8 regression: the two-line content resolution + the inner-box height
// maths. Two halves the card pins:
//  1. 双行内容: git=「项目 · 分支」/ 非 git 或未回=只显项目名 / descriptor 未
//     hydration=单行标题退化——标题永不丢、无占位符；
//  2. 高度（KI-14 口径）: inner 真收（compact ≥8dp、wide 钳 34dp 控件底线）、
//     双行 lineHeight 块装得下最紧的 inner——KI-8 的 cover 补偿与 tab-row-cover
//     已随官方 chrome 触点退役（带高=纯内容高），本文件不再钉底边补偿算术。
//  3. KI-17①: 带底算式（barStyle 高=会话内容顶 inset 的同一真相源）与 gate
//     off ⇒ undefined 的官方模式零差异钉。
import { describe, expect, it } from "vitest";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { FONT_SIZE } from "@/styles/theme";
import {
  SESSION_HEADER_CONTROL_HEIGHT_DP,
  TEXT_LINE_HEIGHT_CEILING,
  resolveSessionHeaderBranch,
  resolveSessionHeaderProjectLabel,
  resolveSessionHeaderRows,
  sessionHeaderBandBottomDp,
  sessionHeaderInnerHeightDp,
  sessionHeaderTopPadDp,
  shellSessionContentInsetStyle,
} from "./compact-rows";

describe("resolveSessionHeaderBranch (checkout_status → 分支槽)", () => {
  it("git + branch → verbatim (trimmed)", () => {
    expect(resolveSessionHeaderBranch({ isGit: true, currentBranch: "feature/login" })).toBe(
      "feature/login",
    );
    expect(resolveSessionHeaderBranch({ isGit: true, currentBranch: " main " })).toBe("main");
  });

  it("非 git / 查询未回 / null 分支 / 空白分支 → null（首行只显项目名）", () => {
    expect(resolveSessionHeaderBranch({ isGit: false, currentBranch: null })).toBeNull();
    expect(resolveSessionHeaderBranch(null)).toBeNull();
    expect(resolveSessionHeaderBranch(undefined)).toBeNull();
    expect(resolveSessionHeaderBranch({ isGit: true, currentBranch: null })).toBeNull();
    expect(resolveSessionHeaderBranch({ isGit: true, currentBranch: "" })).toBeNull();
    expect(resolveSessionHeaderBranch({ isGit: true, currentBranch: "  " })).toBeNull();
  });
});

describe("resolveSessionHeaderProjectLabel (workspace label 链)", () => {
  it('projectCustomName(trim) → projectDisplayName → ""（同 workspace-command-row 口径）', () => {
    expect(
      resolveSessionHeaderProjectLabel({
        projectCustomName: " 我的项目 ",
        projectDisplayName: "ignored",
      }),
    ).toBe("我的项目");
    expect(
      resolveSessionHeaderProjectLabel({ projectCustomName: "  ", projectDisplayName: "Paseo" }),
    ).toBe("Paseo");
    expect(resolveSessionHeaderProjectLabel({ projectDisplayName: "" })).toBe("");
    expect(resolveSessionHeaderProjectLabel(null)).toBe("");
    expect(resolveSessionHeaderProjectLabel(undefined)).toBe("");
  });
});

describe("resolveSessionHeaderRows (双行内容)", () => {
  it("git 仓: 首行=「项目 · 分支」主字重，次行=真标题", () => {
    expect(
      resolveSessionHeaderRows({ projectLabel: "paseo", branch: "main", title: "修复登录超时" }),
    ).toEqual({ primary: "paseo · main", secondary: "修复登录超时" });
  });
  it("非 git / 查询未回: 首行只显项目名——无占位符、无分隔符残留", () => {
    expect(
      resolveSessionHeaderRows({ projectLabel: "local-folder", branch: null, title: "T" }),
    ).toEqual({ primary: "local-folder", secondary: "T" });
  });

  it("descriptor 未 hydration（无项目名）: 单行退化=标题走首行，次行不存在", () => {
    expect(resolveSessionHeaderRows({ projectLabel: "", branch: "main", title: "T" })).toEqual({
      primary: "T",
      secondary: null,
    });
    expect(resolveSessionHeaderRows({ projectLabel: "   ", branch: null, title: "T" })).toEqual({
      primary: "T",
      secondary: null,
    });
  });

  it("标题永不丢（两态都在 primary 或 secondary 出现）", () => {
    const title = "很长的会话标题——单行截断交给 Text numberOfLines";
    for (const input of [
      { projectLabel: "p", branch: "b", title },
      { projectLabel: "p", branch: null, title },
      { projectLabel: "", branch: "b", title },
    ]) {
      const rows = resolveSessionHeaderRows(input);
      expect([rows.primary, rows.secondary]).toContain(title);
    }
  });

  it("项目名两侧空白不进首行", () => {
    expect(resolveSessionHeaderRows({ projectLabel: " paseo ", branch: null, title: "T" })).toEqual(
      { primary: "paseo", secondary: "T" },
    );
  });
});

describe("sessionHeaderInnerHeightDp (KI-14: 带高 = 纯内容高)", () => {
  it("compact inner 真收 56→44（≥8dp），且 ≥ 34dp 控件底线（命中区不动）", () => {
    expect(sessionHeaderInnerHeightDp(true)).toBe(44);
    expect(HEADER_INNER_HEIGHT_MOBILE - sessionHeaderInnerHeightDp(true)).toBeGreaterThanOrEqual(8);
    expect(sessionHeaderInnerHeightDp(true)).toBeGreaterThanOrEqual(
      SESSION_HEADER_CONTROL_HEIGHT_DP,
    );
  });

  it("wide inner 36→34：收紧但钳在控件高底线，wide 同步双行", () => {
    expect(sessionHeaderInnerHeightDp(false)).toBe(34);
    expect(sessionHeaderInnerHeightDp(false)).toBeLessThan(HEADER_INNER_HEIGHT);
    expect(sessionHeaderInnerHeightDp(false)).toBe(SESSION_HEADER_CONTROL_HEIGHT_DP);
  });

  it("双行 lineHeight 块装得下最紧的 inner（wide 34）", () => {
    const block =
      Math.ceil(FONT_SIZE.base * TEXT_LINE_HEIGHT_CEILING) +
      Math.ceil(FONT_SIZE.sm * TEXT_LINE_HEIGHT_CEILING);
    expect(block).toBeLessThanOrEqual(sessionHeaderInnerHeightDp(false));
    expect(block).toBeLessThanOrEqual(sessionHeaderInnerHeightDp(true));
  });
});

describe("sessionHeaderBandBottomDp / shellSessionContentInsetStyle (KI-17① 带底单真相)", () => {
  it("compact 带底 = insets.top + HEADER_TOP_PADDING_MOBILE + inner44（barStyle 同式）", () => {
    expect(sessionHeaderBandBottomDp(24, true)).toBe(24 + HEADER_TOP_PADDING_MOBILE + 44);
    expect(sessionHeaderTopPadDp(true)).toBe(HEADER_TOP_PADDING_MOBILE);
  });

  it("wide 带底 = insets.top + inner34（无 topPad，KI-17② wide 内容高口径）", () => {
    expect(sessionHeaderBandBottomDp(24, false)).toBe(24 + 34);
    expect(sessionHeaderTopPadDp(false)).toBe(0);
  });

  it("inset 系数恒 1；负 inset 钳 0（防御）", () => {
    for (const inset of [0, 24, 38, 48]) {
      expect(sessionHeaderBandBottomDp(inset, true) - sessionHeaderBandBottomDp(0, true)).toBe(
        inset,
      );
    }
    expect(sessionHeaderBandBottomDp(-12, true)).toBe(sessionHeaderBandBottomDp(0, true));
  });

  it("内容 inset = 带底；gate off ⇒ undefined（官方模式逐字节零差异，Main 裁决③）", () => {
    expect(shellSessionContentInsetStyle(true, 38, true)).toEqual({
      paddingTop: sessionHeaderBandBottomDp(38, true),
    });
    expect(shellSessionContentInsetStyle(true, 38, false)).toEqual({
      paddingTop: sessionHeaderBandBottomDp(38, false),
    });
    expect(shellSessionContentInsetStyle(false, 38, true)).toBeUndefined();
    expect(shellSessionContentInsetStyle(false, 0, false)).toBeUndefined();
  });
});
