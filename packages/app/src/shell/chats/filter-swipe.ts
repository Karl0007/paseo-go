// B4-SWIPE (批次四 F5 裁定 10) — the pure half of the 对话页横滑切换: the geometry
// and the two decisions of a page swipe over the 进行中/已归档 filter state machine.
//
// Everything the gesture layer needs to decide is here, so it is testable without
// a screen: (1) does this drag belong to the page swipe, to the list's own vertical
// scroll / pull-to-refresh, or is it still undecided; (2) where may the surface
// actually move (the ruling's 两页边界不回弹 — there are exactly two pages, so a
// page-0 rightward drag and a page-1 leftward drag move nothing); (3) on release,
// does the swipe commit to the other page or snap back.
//
// Units: RNGH reports pointer/translation/velocity in **dp** on Android (the native
// event builders run every number through `PixelUtil.toDIPFromPixel` — verified in
// react-native-gesture-handler 2.28.0: PanGestureHandlerEventDataBuilder.kt +
// GestureHandler.kt's touch payload), `onLayout` widths are dp, and Reanimated
// drives `translateX` in dp. One unit end to end; no PixelRatio anywhere.
//
// The state machine itself is NOT here: the swipe calls the screen's existing
// `setFilter`, the exact setter the header's segment presses (裁定 10「与点 segment
// 同一状态机」). This module only says which page the user asked for.

/** The two filter pages, in reading order: 0 = 进行中, 1 = 已归档. */
export type FilterSwipePage = 0 | 1;

export const FILTER_SWIPE_PAGE_ACTIVE: FilterSwipePage = 0;
export const FILTER_SWIPE_PAGE_ARCHIVED: FilterSwipePage = 1;

/** 裁定 10: 仅两页（无第三态），所以「下一页/上一页」就是「另一页」。 */
export const FILTER_SWIPE_PAGE_COUNT = 2;

export function filterSwipePageForArchived(archivedOnly: boolean): FilterSwipePage {
  return archivedOnly ? FILTER_SWIPE_PAGE_ARCHIVED : FILTER_SWIPE_PAGE_ACTIVE;
}

/** filter 页号 → 屏幕的 `archivedOnly`（换页落地时回到现有 filter state）。 */
export function archivedOnlyForFilterSwipePage(page: FilterSwipePage): boolean {
  return page === FILTER_SWIPE_PAGE_ARCHIVED;
}

/**
 * Horizontal travel (dp) that takes the touch stream away from the list. Deliberately
 * above the row machine's own `horizontal_swipe` slop (8dp @ 1.5 dominance,
 * utils/sidebar-gesture-arbitration) so a swipe is never a coin flip with a row drag,
 * and above the platform touch slop so a tap/jitter never arms the page.
 */
export const SWIPE_ACTIVATE_SLOP_DP = 16;

/** Travel past which the OTHER axis owns the drag — vertical scroll, pull-to-refresh.
 * Same value as the official/mobile-panel intent's escape (shell edge-swipe). */
export const SWIPE_VERTICAL_ESCAPE_DP = 10;

/** 裁定 10: 阈值≈列宽 1/4. */
export const SWIPE_COMMIT_WIDTH_FRACTION = 0.25;

/** 裁定 10 的另一半（速度判定）: 释放尾速（dp/s）过它即换页，哪怕行程不足 1/4 列宽。 */
export const SWIPE_COMMIT_VELOCITY_DP_S = 500;

export type FilterSwipeIntent =
  /** Take the stream: the page surface follows the finger from here. */
  | "activate"
  /** Not ours — the list keeps scrolling/refreshing, terminal for this touch. */
  | "fail"
  /** Still undecided; keep watching the same touch. */
  | "wait";

/**
 * Direction lock for one touch. Vertical dominance loses to the list (异轴无冲突:
 * a scroll or a pull-to-refresh is never a page swipe). Horizontal dominance past
 * `SWIPE_ACTIVATE_SLOP_DP` wins — but ONLY in the direction that has a page:
 * 进行中 sits left of 已归档, so page 0 swipes left and page 1 swipes right.
 * The forbidden direction never activates (nothing moves = no bounce), and past the
 * slop it fails outright so a later reversal can't resurrect a dead swipe.
 */
export function resolveFilterSwipeIntent(input: {
  deltaX: number;
  deltaY: number;
  page: FilterSwipePage;
}): FilterSwipeIntent {
  "worklet";
  const absX = Math.abs(input.deltaX);
  const absY = Math.abs(input.deltaY);
  if (absY > SWIPE_VERTICAL_ESCAPE_DP && absY > absX) return "fail";
  const towardNextPage =
    input.page === FILTER_SWIPE_PAGE_ACTIVE ? input.deltaX < 0 : input.deltaX > 0;
  if (!towardNextPage) {
    return absX > SWIPE_ACTIVATE_SLOP_DP ? "fail" : "wait";
  }
  return absX >= SWIPE_ACTIVATE_SLOP_DP ? "activate" : "wait";
}

/**
 * The boundary rule: the surface may only travel toward the page that exists.
 * Page 0 lives in [-width, 0], page 1 in [0, width]; anything further clamps flat,
 * which is what makes 「滑到头不回弹」 a property of the geometry rather than a
 * rubber-band animation to remember to disable.
 */
export function clampFilterSwipeTranslation(
  translationX: number,
  page: FilterSwipePage,
  widthDp: number,
): number {
  "worklet";
  if (widthDp <= 0) return 0;
  if (page === FILTER_SWIPE_PAGE_ACTIVE) {
    return Math.min(0, Math.max(-widthDp, translationX));
  }
  return Math.max(0, Math.min(widthDp, translationX));
}

/**
 * Where the incoming page starts its entrance: 已归档 sits to the right of 进行中,
 * so it enters from +width and 进行中 enters from -width. The exit edge of the
 * outgoing page is the same number negated — one source for the pair.
 */
export function filterSwipeEntryEdge(page: FilterSwipePage, widthDp: number): number {
  "worklet";
  if (widthDp <= 0) return 0;
  return page === FILTER_SWIPE_PAGE_ARCHIVED ? widthDp : -widthDp;
}

export type FilterSwipeRelease =
  | { readonly kind: "switch"; readonly page: FilterSwipePage; readonly exitEdge: number }
  | { readonly kind: "snap-back" };

const SNAP_BACK: FilterSwipeRelease = { kind: "snap-back" };

/**
 * Release decision on the CLAMPED offset (so a boundary drag that pinned at 0 can
 * never commit) plus the tail speed. Both criteria require the allowed direction:
 * a hard flick back toward the wall snaps, it does not switch.
 */
export function decideFilterSwipeRelease(input: {
  translationX: number;
  velocityX: number;
  page: FilterSwipePage;
  widthDp: number;
}): FilterSwipeRelease {
  "worklet";
  const { translationX, velocityX, page, widthDp } = input;
  if (widthDp <= 0) return SNAP_BACK;
  const target: FilterSwipePage =
    page === FILTER_SWIPE_PAGE_ACTIVE ? FILTER_SWIPE_PAGE_ARCHIVED : FILTER_SWIPE_PAGE_ACTIVE;
  const forward = target === FILTER_SWIPE_PAGE_ARCHIVED;
  // 反向尾速=用户往回甩（把手指收向出发的那面墙），无论行程多少都取消换页。
  const reverseFlick = forward
    ? velocityX >= SWIPE_COMMIT_VELOCITY_DP_S
    : velocityX <= -SWIPE_COMMIT_VELOCITY_DP_S;
  if (reverseFlick) return SNAP_BACK;
  const distanceCommit = forward
    ? translationX <= -widthDp * SWIPE_COMMIT_WIDTH_FRACTION
    : translationX >= widthDp * SWIPE_COMMIT_WIDTH_FRACTION;
  const velocityCommit = forward
    ? velocityX <= -SWIPE_COMMIT_VELOCITY_DP_S
    : velocityX >= SWIPE_COMMIT_VELOCITY_DP_S;
  if (!distanceCommit && !velocityCommit) return SNAP_BACK;
  return { kind: "switch", page: target, exitEdge: -filterSwipeEntryEdge(target, widthDp) };
}
