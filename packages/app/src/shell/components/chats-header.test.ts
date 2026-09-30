// B4-F1/Q2 三档降级断点单测（卡契约：260/300/400dp 列三档断言）。
// 现实宽度对账（MatePad BRT-W09 帧轮）：分栏列表列=260 (md)/300 (lg)（tablet/metrics
// 常量表），紧凑全屏 ≥384 量级——三档必须在这三个现实宽度上各占一档，且断点夹在
// 相邻现实宽度之间（换列宽=换档，列内不抖动）。
// 纯函数导入姿势对齐 shell-tab-header.test.ts（node env，无挂载）。
import { describe, expect, it } from "vitest";
import {
  CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP,
  CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP,
  chatFilterSegmentFitsTier,
  chatFilterSegmentTierForWidthDp,
  chatFilterTitleFits,
  downgradeChatFilterSegmentTier,
  lowerChatFilterSegmentTier,
} from "@/shell/components/chats-header";

describe("chatFilterSegmentTierForWidthDp (B4-F1/Q2)", () => {
  it("steps the three real column widths into the three tiers", () => {
    expect(chatFilterSegmentTierForWidthDp(260)).toBe("icon"); // md 列
    expect(chatFilterSegmentTierForWidthDp(300)).toBe("short"); // lg 列
    expect(chatFilterSegmentTierForWidthDp(400)).toBe("full"); // 紧凑全屏
  });

  it("keeps the thresholds between the adjacent real widths", () => {
    // 断点必须严格落在 (260,300] 与 (300,400]：列宽常量表改窄/改宽时此钉先红。
    expect(CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP).toBeGreaterThan(260);
    expect(CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP).toBeLessThanOrEqual(300);
    expect(CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP).toBeGreaterThan(300);
    expect(CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP).toBeLessThanOrEqual(400);
  });

  it("flips tiers exactly at the thresholds (inclusive lower bound)", () => {
    expect(chatFilterSegmentTierForWidthDp(CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP - 1)).toBe(
      "icon",
    );
    expect(chatFilterSegmentTierForWidthDp(CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP)).toBe("short");
    expect(chatFilterSegmentTierForWidthDp(CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP - 1)).toBe(
      "short",
    );
    expect(chatFilterSegmentTierForWidthDp(CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP)).toBe("full");
  });

  it("is monotone: wider never degrades", () => {
    const rank = { icon: 0, short: 1, full: 2 } as const;
    let prev = -1;
    for (let w = 200; w <= 600; w += 5) {
      const r = rank[chatFilterSegmentTierForWidthDp(w)];
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(prev).toBe(2);
  });
});

// R4-05: 实测宽（MatePad BRT-W09 @400dpi，uiautomator bounds ÷ 2.5 = dp）。断点只
// 是上限，真档位由这两个纯函数用实测宽决定——文案与计数都不受断点控制。
describe("chatFilterSegmentFitsTier / chatFilterTitleFits (R4-05)", () => {
  const zhShort = { pillWidthDp: 54.8, segmentGroupWidthDp: 103.6 };
  const enShort = { pillWidthDp: 54.8, segmentGroupWidthDp: 118.4 };
  // 修复前 en 短称档的实测行宽（旧文案「Archived 1」+ 旧内边距 12）。
  const enShortBeforeFix = { pillWidthDp: 62.8, segmentGroupWidthDp: 150 };
  const enFull = { pillWidthDp: 62.8, segmentGroupWidthDp: 185.6 };

  it("keeps the short tier at the 300dp lg column in BOTH locales", () => {
    expect(chatFilterSegmentFitsTier({ columnWidthDp: 300, ...zhShort })).toBe(true);
    expect(chatFilterSegmentFitsTier({ columnWidthDp: 300, ...enShort })).toBe(true);
  });

  it("rejects the pre-fix en row that pushed ＋ out of the column", () => {
    expect(chatFilterSegmentFitsTier({ columnWidthDp: 300, ...enShortBeforeFix })).toBe(false);
  });

  it("degrades on a wider archived count instead of overflowing", () => {
    // 「Arch. 1」→「Arch. 128」实测再吃 ~12dp：300dp 列装不下 → 降图标档。
    expect(
      chatFilterSegmentFitsTier({
        columnWidthDp: 300,
        pillWidthDp: 54.8,
        segmentGroupWidthDp: 130.4,
      }),
    ).toBe(false);
  });

  it("hides the full-tier title rather than starving it to 「Cha…」", () => {
    // 400dp 电话：全称 segment 本身装得下，但标题只剩 31.6dp → 宁可无标题。
    expect(chatFilterSegmentFitsTier({ columnWidthDp: 400, ...enFull })).toBe(true);
    expect(chatFilterTitleFits({ columnWidthDp: 400, ...enFull })).toBe(false);
    // 640dp 紧凑竖屏：剩 271.6dp，标题完整（与今天真机形态一致）。
    expect(chatFilterTitleFits({ columnWidthDp: 640, ...enFull })).toBe(true);
  });

  it("walks the ladder down and stops at the icon tier", () => {
    expect(downgradeChatFilterSegmentTier("full")).toBe("short");
    expect(downgradeChatFilterSegmentTier("short")).toBe("icon");
    expect(downgradeChatFilterSegmentTier("icon")).toBe("icon");
    expect(lowerChatFilterSegmentTier("full", "short")).toBe("short");
    expect(lowerChatFilterSegmentTier("short", "full")).toBe("short");
  });
});
