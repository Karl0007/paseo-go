// B4-SWIPE acceptance (批次四 F5 裁定 10): the page-swipe decisions, pinned without a
// screen. The card's numbers are the subject — 阈值≈列宽 1/4 或速度判定、仅两页、
// 滑到头不回弹、异轴（垂直滚动/下拉刷新）不被吃 — plus the direction contract the
// two-page layout implies: 进行中 sits left of 已归档, so a swipe only ever moves
// toward a page that exists.
import { describe, expect, it } from "vitest";
import {
  archivedOnlyForFilterSwipePage,
  clampFilterSwipeTranslation,
  decideFilterSwipeRelease,
  filterSwipeEntryEdge,
  filterSwipePageForArchived,
  FILTER_SWIPE_PAGE_ACTIVE,
  FILTER_SWIPE_PAGE_ARCHIVED,
  FILTER_SWIPE_PAGE_COUNT,
  resolveFilterSwipeIntent,
  SWIPE_ACTIVATE_SLOP_DP,
  SWIPE_COMMIT_VELOCITY_DP_S,
  SWIPE_COMMIT_WIDTH_FRACTION,
  SWIPE_VERTICAL_ESCAPE_DP,
} from "./filter-swipe";

/** 列宽取 MatePad 分栏 lg 列（300dp）量级：1/4 = 75dp，阈值可分辨。 */
const WIDTH = 300;
const QUARTER = WIDTH * SWIPE_COMMIT_WIDTH_FRACTION;

describe("filter swipe page mapping", () => {
  it("keeps the ruling's page count at two (no third state)", () => {
    expect(FILTER_SWIPE_PAGE_COUNT).toBe(2);
    expect(FILTER_SWIPE_PAGE_ACTIVE).toBe(0);
    expect(FILTER_SWIPE_PAGE_ARCHIVED).toBe(1);
  });

  it("maps the screen's archivedOnly onto the page index and back", () => {
    expect(filterSwipePageForArchived(false)).toBe(FILTER_SWIPE_PAGE_ACTIVE);
    expect(filterSwipePageForArchived(true)).toBe(FILTER_SWIPE_PAGE_ARCHIVED);
    expect(archivedOnlyForFilterSwipePage(FILTER_SWIPE_PAGE_ACTIVE)).toBe(false);
    expect(archivedOnlyForFilterSwipePage(FILTER_SWIPE_PAGE_ARCHIVED)).toBe(true);
  });
});

describe("resolveFilterSwipeIntent", () => {
  it("pins the card's geometry: activation slop above the row machine's 8dp swipe", () => {
    // 行机器（decideLongPressMove）在 8dp@1.5 主导就判 horizontal_swipe；换页阈值必须
    // 在它之上，否则横滑与行手势同一帧抢流。
    expect(SWIPE_ACTIVATE_SLOP_DP).toBeGreaterThan(8);
    expect(SWIPE_VERTICAL_ESCAPE_DP).toBeLessThan(SWIPE_ACTIVATE_SLOP_DP);
    expect(SWIPE_COMMIT_WIDTH_FRACTION).toBe(0.25);
  });

  it("activates a leftward drag on 进行中 (the 已归档 direction)", () => {
    expect(
      resolveFilterSwipeIntent({
        deltaX: -SWIPE_ACTIVATE_SLOP_DP,
        deltaY: 0,
        page: FILTER_SWIPE_PAGE_ACTIVE,
      }),
    ).toBe("activate");
    expect(
      resolveFilterSwipeIntent({ deltaX: -180, deltaY: 20, page: FILTER_SWIPE_PAGE_ACTIVE }),
    ).toBe("activate");
  });

  it("activates a rightward drag on 已归档 (back to 进行中)", () => {
    expect(
      resolveFilterSwipeIntent({
        deltaX: SWIPE_ACTIVATE_SLOP_DP,
        deltaY: 0,
        page: FILTER_SWIPE_PAGE_ARCHIVED,
      }),
    ).toBe("activate");
  });

  it("hands vertical-dominant drags to the list (scroll / pull-to-refresh)", () => {
    expect(
      resolveFilterSwipeIntent({ deltaX: 0, deltaY: 80, page: FILTER_SWIPE_PAGE_ACTIVE }),
    ).toBe("fail");
    expect(
      resolveFilterSwipeIntent({ deltaX: -40, deltaY: 90, page: FILTER_SWIPE_PAGE_ACTIVE }),
    ).toBe("fail");
    // 异轴让位优先于阈值：一帧 120dp 的向下甩动不是换页。
    expect(
      resolveFilterSwipeIntent({ deltaX: -120, deltaY: 121, page: FILTER_SWIPE_PAGE_ACTIVE }),
    ).toBe("fail");
  });

  it("never activates toward a wall — 进行中 右滑、已归档 左滑都不存在那一页", () => {
    expect(
      resolveFilterSwipeIntent({ deltaX: 200, deltaY: 0, page: FILTER_SWIPE_PAGE_ACTIVE }),
    ).toBe("fail");
    expect(
      resolveFilterSwipeIntent({ deltaX: -200, deltaY: 0, page: FILTER_SWIPE_PAGE_ARCHIVED }),
    ).toBe("fail");
  });

  it("stays undecided below the slop, in either direction", () => {
    expect(
      resolveFilterSwipeIntent({ deltaX: -3, deltaY: -2, page: FILTER_SWIPE_PAGE_ACTIVE }),
    ).toBe("wait");
    // 墙侧的小抖动保持 wait：手指先往墙偏 5dp 再折回来，仍应能换页。
    expect(resolveFilterSwipeIntent({ deltaX: 5, deltaY: 0, page: FILTER_SWIPE_PAGE_ACTIVE })).toBe(
      "wait",
    );
    expect(
      resolveFilterSwipeIntent({
        deltaX: -(SWIPE_ACTIVATE_SLOP_DP - 1),
        deltaY: 0,
        page: FILTER_SWIPE_PAGE_ACTIVE,
      }),
    ).toBe("wait");
  });

  it("gives the exact diagonal to the horizontal axis", () => {
    expect(
      resolveFilterSwipeIntent({
        deltaX: -SWIPE_ACTIVATE_SLOP_DP,
        deltaY: -SWIPE_ACTIVATE_SLOP_DP,
        page: FILTER_SWIPE_PAGE_ACTIVE,
      }),
    ).toBe("activate");
  });
});

describe("clampFilterSwipeTranslation", () => {
  it("keeps 进行中 inside [-width, 0] — the no-bounce boundary", () => {
    expect(clampFilterSwipeTranslation(-40, FILTER_SWIPE_PAGE_ACTIVE, WIDTH)).toBe(-40);
    expect(clampFilterSwipeTranslation(-WIDTH, FILTER_SWIPE_PAGE_ACTIVE, WIDTH)).toBe(-WIDTH);
    expect(clampFilterSwipeTranslation(-(WIDTH * 3), FILTER_SWIPE_PAGE_ACTIVE, WIDTH)).toBe(-WIDTH);
    expect(clampFilterSwipeTranslation(120, FILTER_SWIPE_PAGE_ACTIVE, WIDTH)).toBe(0);
  });

  it("keeps 已归档 inside [0, width]", () => {
    expect(clampFilterSwipeTranslation(40, FILTER_SWIPE_PAGE_ARCHIVED, WIDTH)).toBe(40);
    expect(clampFilterSwipeTranslation(WIDTH * 3, FILTER_SWIPE_PAGE_ARCHIVED, WIDTH)).toBe(WIDTH);
    expect(clampFilterSwipeTranslation(-120, FILTER_SWIPE_PAGE_ARCHIVED, WIDTH)).toBe(0);
  });

  it("moves nothing until the column is measured", () => {
    expect(clampFilterSwipeTranslation(-100, FILTER_SWIPE_PAGE_ACTIVE, 0)).toBe(0);
  });
});

describe("decideFilterSwipeRelease", () => {
  it("commits at exactly 1/4 of the column width", () => {
    expect(
      decideFilterSwipeRelease({
        translationX: -QUARTER,
        velocityX: 0,
        page: FILTER_SWIPE_PAGE_ACTIVE,
        widthDp: WIDTH,
      }),
    ).toEqual({
      kind: "switch",
      page: FILTER_SWIPE_PAGE_ARCHIVED,
      exitEdge: -WIDTH,
    });
  });

  it("snaps back one dp short of the threshold", () => {
    expect(
      decideFilterSwipeRelease({
        translationX: -(QUARTER - 1),
        velocityX: 0,
        page: FILTER_SWIPE_PAGE_ACTIVE,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("commits a short flick on tail speed alone", () => {
    expect(
      decideFilterSwipeRelease({
        translationX: -20,
        velocityX: -(SWIPE_COMMIT_VELOCITY_DP_S + 1),
        page: FILTER_SWIPE_PAGE_ACTIVE,
        widthDp: WIDTH,
      }),
    ).toMatchObject({ kind: "switch", page: FILTER_SWIPE_PAGE_ARCHIVED });
    expect(
      decideFilterSwipeRelease({
        translationX: 20,
        velocityX: SWIPE_COMMIT_VELOCITY_DP_S + 1,
        page: FILTER_SWIPE_PAGE_ARCHIVED,
        widthDp: WIDTH,
      }),
    ).toMatchObject({ kind: "switch", page: FILTER_SWIPE_PAGE_ACTIVE });
  });

  it("ignores a tail speed that points at the wall", () => {
    // 行程够（向左 3/4 列）但收尾向右甩：用户把方向反回来了，回弹。
    expect(
      decideFilterSwipeRelease({
        translationX: -QUARTER * 3,
        velocityX: SWIPE_COMMIT_VELOCITY_DP_S * 3,
        page: FILTER_SWIPE_PAGE_ACTIVE,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("never commits a drag pinned at the boundary", () => {
    // clamp 之后墙侧行程恒为 0 —— 边界不回弹也不换页。
    expect(
      decideFilterSwipeRelease({
        translationX: clampFilterSwipeTranslation(240, FILTER_SWIPE_PAGE_ACTIVE, WIDTH),
        velocityX: 0,
        page: FILTER_SWIPE_PAGE_ACTIVE,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("mirrors the geometry: exit edge is the target page's entry edge, negated", () => {
    const forward = decideFilterSwipeRelease({
      translationX: -QUARTER,
      velocityX: 0,
      page: FILTER_SWIPE_PAGE_ACTIVE,
      widthDp: WIDTH,
    });
    const back = decideFilterSwipeRelease({
      translationX: QUARTER,
      velocityX: 0,
      page: FILTER_SWIPE_PAGE_ARCHIVED,
      widthDp: WIDTH,
    });
    if (forward.kind !== "switch" || back.kind !== "switch") {
      throw new Error("expected both drags to commit");
    }
    expect(forward.exitEdge).toBe(-filterSwipeEntryEdge(forward.page, WIDTH));
    expect(back.exitEdge).toBe(-filterSwipeEntryEdge(back.page, WIDTH));
    // 已归档在右：它从 +width 进场，进行中从 -width 进场。
    expect(filterSwipeEntryEdge(FILTER_SWIPE_PAGE_ARCHIVED, WIDTH)).toBe(WIDTH);
    expect(filterSwipeEntryEdge(FILTER_SWIPE_PAGE_ACTIVE, WIDTH)).toBe(-WIDTH);
  });

  it("snaps back while the column is unmeasured", () => {
    expect(
      decideFilterSwipeRelease({
        translationX: -QUARTER,
        velocityX: -2000,
        page: FILTER_SWIPE_PAGE_ACTIVE,
        widthDp: 0,
      }),
    ).toEqual({ kind: "snap-back" });
  });
});
