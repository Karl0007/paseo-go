// KI-12 验收②：统一顶栏容器的纯逻辑（高度/inset）单测。契约本体：
// - 等高 = 单一常量：三 tab 渲染同一容器、accessory 带空也保留，高度与内容无关；
//   钉死 96dp 让「改带高」必须是一次有意识的编辑（报告在册值）。
// - inset 只加一次：总高对 inset 线性且系数恒 1；负值钳 0。
import { describe, expect, it } from "vitest";
import {
  SHELL_TAB_HEADER_ACCESSORY_HEIGHT_DP,
  SHELL_TAB_HEADER_BAR_HEIGHT_DP,
  SHELL_TAB_HEADER_BOTTOM_PADDING_DP,
  SHELL_TAB_HEADER_GAP_DP,
  shellTabHeaderContentHeightDp,
  shellTabHeaderTotalHeightDp,
} from "@/shell/components/shell-tab-header";

describe("shellTabHeaderContentHeightDp", () => {
  it("equals the sum of the exported band constants (style/logic drift guard)", () => {
    expect(shellTabHeaderContentHeightDp()).toBe(
      SHELL_TAB_HEADER_BAR_HEIGHT_DP +
        SHELL_TAB_HEADER_GAP_DP +
        SHELL_TAB_HEADER_ACCESSORY_HEIGHT_DP +
        SHELL_TAB_HEADER_BOTTOM_PADDING_DP,
    );
  });

  it("is the KI-12 adopted equal height (96dp content)", () => {
    expect(shellTabHeaderContentHeightDp()).toBe(96);
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
