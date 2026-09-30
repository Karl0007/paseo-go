// B4-F1/Q2 三档降级断点单测（卡契约：260/300/400dp 列三档断言）。
// 现实宽度对账（MatePad BRT-W09 帧轮）：分栏列表列=260 (md)/300 (lg)（tablet/metrics
// 常量表），紧凑全屏 ≥384 量级——三档必须在这三个现实宽度上各占一档，且断点夹在
// 相邻现实宽度之间（换列宽=换档，列内不抖动）。
// 纯函数导入姿势对齐 shell-tab-header.test.ts（node env，无挂载）。
import { describe, expect, it } from "vitest";
import {
  CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP,
  CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP,
  chatFilterSegmentTierForWidthDp,
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
