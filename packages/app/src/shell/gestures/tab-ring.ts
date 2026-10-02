// B8-SWIPE (批次八 F26) — the pure half of the 横滑 tab 环: the linear ring
// [进行中 → 已归档 → 工作区 → 我的 → (循环)进行中], its bidirectional wrap
// arithmetic, the direction lock, the follow-the-finger geometry and the release
// decision. This module REPLACES `shell/chats/filter-swipe.ts` (B4-SWIPE 裁定 10):
// the 段内滑 进行中↔已归档 is slots 0↔1 of the same ring — one state machine, not
// two gestures fighting over the same touch.
//
// Direction semantics (冻结口径, 与段内滑一致): 前进 = 手指左滑 → 右边的页签
// (advance); 后退 = 手指右滑 → 左边的页签 (retreat). The ring LOOPS both ways, so
// unlike the two-page model there is NO wall: every slot has both neighbours and
// every horizontal lock activates. 「两页边界不回弹」 generalises to 「环无边界」:
// the surface pins at one page-width out (fully off-screen) and the commit hands
// the next slot its entrance from the opposite wall.
//
// Units: dp end to end (RNGH reports pointer/translation/velocity in dp on
// Android — verified in filter-swipe's era against react-native-gesture-handler
// 2.28.0; `onLayout` widths are dp; Reanimated drives translateX in dp). No
// PixelRatio anywhere.
//
// The state machine itself is NOT here: a commit lands through the screen's own
// setter (chats 0↔1 = the segment's `setFilter`) or the rail's own tab verb
// (`router.navigate(SHELL.*)`) — see `use-shell-ring-swipe`.

import { SHELL, SHELL_TAB } from "../routes";
import type { ShellTab } from "../stores/settings";

/** Ring slots in reading order. 0/1 are the 对话 filter pair (裁定 10 的两页). */
export const RING_SLOT_CHATS_ACTIVE = 0;
export const RING_SLOT_CHATS_ARCHIVED = 1;
export const RING_SLOT_WORKSPACE = 2;
export const RING_SLOT_ME = 3;

export type RingSlot =
  | typeof RING_SLOT_CHATS_ACTIVE
  | typeof RING_SLOT_CHATS_ARCHIVED
  | typeof RING_SLOT_WORKSPACE
  | typeof RING_SLOT_ME;

/** 线性环四格：进行中/已归档/工作区/我的。 */
export const RING_SLOT_COUNT = 4;

/** 前进=切右边页签的手势（手指左滑）；后退=手指右滑。 */
export type RingDirection = "forward" | "back";

/** The slot's owning tab section — what the focus bus and navigation key off. */
const RING_SECTIONS: readonly ShellTab[] = [
  SHELL_TAB.chats,
  SHELL_TAB.chats,
  SHELL_TAB.workspace,
  SHELL_TAB.me,
];

/** The tab's front slot — where a plain tab focus (segment untouched) stands. */
const RING_TAB_HEAD: Record<ShellTab, RingSlot> = {
  [SHELL_TAB.chats]: RING_SLOT_CHATS_ACTIVE,
  [SHELL_TAB.workspace]: RING_SLOT_WORKSPACE,
  [SHELL_TAB.me]: RING_SLOT_ME,
};

/** (tab, 对话 filter) → ring slot: the screen-state projection the hook reads. */
export function ringSlotForView(tab: ShellTab, archivedOnly: boolean): RingSlot {
  "worklet";
  if (tab === SHELL_TAB.chats) {
    return archivedOnly ? RING_SLOT_CHATS_ARCHIVED : RING_SLOT_CHATS_ACTIVE;
  }
  return RING_TAB_HEAD[tab];
}

export function ringSectionForSlot(slot: RingSlot): ShellTab {
  "worklet";
  return RING_SECTIONS[slot];
}

/** 跨 tab 落地的官方导航路径（rail 同款动词 `router.navigate` 的目标）。 */
export function ringTabPathForSlot(slot: RingSlot): string {
  const section = ringSectionForSlot(slot);
  if (section === SHELL_TAB.workspace) return SHELL.workspace;
  if (section === SHELL_TAB.me) return SHELL.me;
  return SHELL.chats;
}

/** 前进一格，环回：我的 → 进行中 (F26 边界循环). */
export function advanceRingSlot(slot: RingSlot): RingSlot {
  "worklet";
  return ((slot + 1) % RING_SLOT_COUNT) as RingSlot;
}

/** 后退一格，环回：进行中 → 我的. */
export function retreatRingSlot(slot: RingSlot): RingSlot {
  "worklet";
  return ((slot + RING_SLOT_COUNT - 1) % RING_SLOT_COUNT) as RingSlot;
}

export function ringSlotForDirection(slot: RingSlot, direction: RingDirection): RingSlot {
  "worklet";
  return direction === "forward" ? advanceRingSlot(slot) : retreatRingSlot(slot);
}

/**
 * Horizontal travel (dp) that takes the touch stream from the list. Same number
 * as B4-SWIPE (方向语义一致): above the row machine's `horizontal_swipe` slop
 * (8dp) so a swipe is never a coin flip with a row drag, above the platform
 * touch slop so taps/jitter never arm the ring.
 */
export const RING_ACTIVATE_SLOP_DP = 16;

/** Travel past which the OTHER axis owns the drag — vertical scroll, 下拉刷新. */
export const RING_VERTICAL_ESCAPE_DP = 10;

/** 裁定 10 的阈值沿用到环：≈列宽 1/4. */
export const RING_COMMIT_WIDTH_FRACTION = 0.25;

/** 速度判定（裁定 10 的另一半）：释放尾速过它即换页，哪怕行程不足 1/4 列宽。 */
export const RING_COMMIT_VELOCITY_DP_S = 500;

export type RingSwipeIntent =
  /** Take the stream: the surface follows the finger from here. */
  | "activate"
  /** Not ours — the list keeps scrolling/refreshing, terminal for this touch. */
  | "fail"
  /** Still undecided; keep watching the same touch. */
  | "wait";

/**
 * Direction lock for one touch. Vertical dominance loses to the list (异轴无冲突).
 * Horizontal past the slop activates in EITHER direction — the ring loops, so
 * every slot has a page on both sides and the two-page model's wall rule
 * (「进行中右滑不存在那一页」) is exactly what F26 retired.
 */
export function resolveRingSwipeIntent(input: { deltaX: number; deltaY: number }): RingSwipeIntent {
  "worklet";
  const absX = Math.abs(input.deltaX);
  const absY = Math.abs(input.deltaY);
  if (absY > RING_VERTICAL_ESCAPE_DP && absY > absX) return "fail";
  return absX >= RING_ACTIVATE_SLOP_DP ? "activate" : "wait";
}

/**
 * Follow-the-finger geometry: the surface may travel up to one full page-width
 * out in either direction (at ±width it is exactly off-screen; further pins —
 * 环无边界，但也不露半个屏幕的空白).
 */
export function clampRingSwipeTranslation(translationX: number, widthDp: number): number {
  "worklet";
  if (widthDp <= 0) return 0;
  return Math.max(-widthDp, Math.min(widthDp, translationX));
}

/** 出场墙：前进滑向左墙 (-width)，后退滑向右墙 (+width). */
export function ringExitEdge(direction: RingDirection, widthDp: number): number {
  "worklet";
  if (widthDp <= 0) return 0;
  return direction === "forward" ? -widthDp : widthDp;
}

/** 进场墙：下一格从出场墙的对侧进（一个来源，一对数字）. */
export function ringEntryEdge(direction: RingDirection, widthDp: number): number {
  "worklet";
  return -ringExitEdge(direction, widthDp);
}

export type RingSwipeRelease =
  | {
      readonly kind: "switch";
      readonly direction: RingDirection;
      readonly target: RingSlot;
      readonly exitEdge: number;
    }
  | { readonly kind: "snap-back" };

const SNAP_BACK: RingSwipeRelease = { kind: "snap-back" };

/**
 * Release decision: 行程过 1/4 列宽或尾速过阈值即换页，方向由位移符号定（位移为零
 * 的纯甩动由尾速定）；反向尾速（手指收回出发侧）无论行程都取消换页——与段内滑同款。
 * 目标格走环算术，3→0 / 0→3 的循环在这里落地。
 */
export function decideRingSwipeRelease(input: {
  translationX: number;
  velocityX: number;
  slot: RingSlot;
  widthDp: number;
}): RingSwipeRelease {
  "worklet";
  const { translationX, velocityX, slot, widthDp } = input;
  if (widthDp <= 0) return SNAP_BACK;
  let direction: RingDirection | null = null;
  if (translationX < 0) direction = "forward";
  else if (translationX > 0) direction = "back";
  else if (velocityX < 0) direction = "forward";
  else if (velocityX > 0) direction = "back";
  if (direction === null) return SNAP_BACK;
  const forward = direction === "forward";
  // 反向尾速=用户往回甩（把手指收向出发的方向），无论行程多少都取消换页。
  const reverseFlick = forward
    ? velocityX >= RING_COMMIT_VELOCITY_DP_S
    : velocityX <= -RING_COMMIT_VELOCITY_DP_S;
  if (reverseFlick) return SNAP_BACK;
  const distanceCommit = forward
    ? translationX <= -widthDp * RING_COMMIT_WIDTH_FRACTION
    : translationX >= widthDp * RING_COMMIT_WIDTH_FRACTION;
  const velocityCommit = forward
    ? velocityX <= -RING_COMMIT_VELOCITY_DP_S
    : velocityX >= RING_COMMIT_VELOCITY_DP_S;
  if (!distanceCommit && !velocityCommit) return SNAP_BACK;
  return {
    kind: "switch",
    direction,
    target: ringSlotForDirection(slot, direction),
    exitEdge: ringExitEdge(direction, widthDp),
  };
}
