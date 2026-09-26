// C30: the §4 sizing table as executable arithmetic — these are the numbers the
// §2 form-factor matrix promises (md 轨56+列表260+详情≥404; lg 轨64+列表300+
// 详情660 on the MatePad's 1024dp landscape). Components consume these as
// breakpoint-keyed Unistyles values; the table itself is the contract.
import { describe, expect, it } from "vitest";
import {
  TABLET_DETAIL_CONTENT_MAX_WIDTH,
  TABLET_DETAIL_MIN_WIDTH,
  TABLET_LIST_WIDTH,
  TABLET_RAIL_WIDTH,
} from "./metrics";

describe("tablet split widths (DESIGN-tablet.md §4)", () => {
  it("pairs the narrow column set at md and the standard set at lg+", () => {
    expect(TABLET_RAIL_WIDTH).toEqual({ md: 56, lg: 64 });
    expect(TABLET_LIST_WIDTH).toEqual({ md: 260, lg: 300 });
  });

  it("keeps the detail column at or above its floor at every active breakpoint", () => {
    // md window floor 720; MatePad landscape is exactly lg's 1024 (xl inherits lg).
    expect(720 - TABLET_RAIL_WIDTH.md - TABLET_LIST_WIDTH.md).toBeGreaterThanOrEqual(
      TABLET_DETAIL_MIN_WIDTH,
    );
    expect(1024 - TABLET_RAIL_WIDTH.lg - TABLET_LIST_WIDTH.lg).toBe(660);
  });

  it("reuses the official detail constants", () => {
    // §4-5: min = MIN_DESKTOP_CENTER_WIDTH, content max = MAX_CONTENT_WIDTH.
    expect(TABLET_DETAIL_MIN_WIDTH).toBe(400);
    expect(TABLET_DETAIL_CONTENT_MAX_WIDTH).toBe(820);
  });
});
