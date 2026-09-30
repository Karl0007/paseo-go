// B4-F1（裁定 1，翻案 KI-12 的 96dp 两带）：统一顶栏容器的纯逻辑（高度/inset）
// 单测。契约本体：
// - 等高 = 单一常量：三 tab 渲染同一单行容器（accessory 带已废除），高度与内容
//   无关；钉死 60dp（顶衬8+bar44+底衬8）让「改带高」必须是一次有意识的编辑。
//   三 tab 同一常量 ⇒ KI-12 的等高验收在新契约下依然成立。
// - inset 只加一次：总高对 inset 线性且系数恒 1；负值钳 0。
import { describe, expect, it } from "vitest";
import {
  SHELL_TAB_HEADER_BAR_HEIGHT_DP,
  SHELL_TAB_HEADER_BOTTOM_PADDING_DP,
  SHELL_TAB_HEADER_TOP_PADDING_DP,
  shellTabHeaderContentHeightDp,
  shellTabHeaderTotalHeightDp,
} from "@/shell/components/shell-tab-header";

describe("shellTabHeaderContentHeightDp", () => {
  it("equals the sum of the exported band constants (style/logic drift guard)", () => {
    expect(shellTabHeaderContentHeightDp()).toBe(
      SHELL_TAB_HEADER_TOP_PADDING_DP +
        SHELL_TAB_HEADER_BAR_HEIGHT_DP +
        SHELL_TAB_HEADER_BOTTOM_PADDING_DP,
    );
  });

  it("is the B4-F1 adopted single-row equal height (60dp content)", () => {
    expect(shellTabHeaderContentHeightDp()).toBe(60);
  });
});

describe("shellTabHeaderTotalHeightDp", () => {
  it("adds the status-bar inset exactly once (slope 1 for every device inset)", () => {
    for (const inset of [0, 24, 38, 48]) {
      expect(shellTabHeaderTotalHeightDp(inset) - shellTabHeaderTotalHeightDp(0)).toBe(inset);
    }
  });

  it("clamps a negative inset to zero", () => {
    expect(shellTabHeaderTotalHeightDp(-12)).toBe(shellTabHeaderContentHeightDp());
  });
});
