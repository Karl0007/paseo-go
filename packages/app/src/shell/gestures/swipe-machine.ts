// B8-SWIPE (批次八 F26+F27) + B8-FILESWIP (F29) — the ONE horizontal-swipe
// arbiter. Three verdicts share one state machine so they can never fight:
//
//   role "tab-ring"   (root tab frontmost)   手指左滑=环前进 / 右滑=环后退
//   role "stack-back" (堆叠页 frontmost)      手指右滑=pop 返回，不限左缘带；
//                                             手指左滑 FAIL —— 堆叠页上左滑不切
//                                             tab（返回栈优先，F27 冻结口径）
//   role "files-segment" (文件页内层段 pager)  线性三段跟手；边界=FAIL 让位——
//                                             同一触摸流交给祖先面（栈页=
//                                             stack-back，tab 宿主=主环），
//                                             绝不回卷（F29 冻结口径）
//
// 堆叠优先 is structural AND pinned here: the ring's hosts live inside the tab
// screens, so a pushed screen covers their views; on top of that the ring hook
// asks THIS machine with `stackInFront` read from the frontmost bus — a touch on
// a stack page can only ever be judged by the stack-back branch.
//
// 声明性豁免 (F27 冲突审计): `horizontalScrolled` is the HorizontalScrollContext
// posture — a registered horizontal surface (diff 代码块) that started the touch
// scrolled off its leading edge keeps its own scroll; neither arbiter steals it.
// `blocked` carries each surface's own mutual-exclusion band (行拖拽 arm→menu→drag、
// 搜索态、换页动画进行中) — the B4-SWIPE 8 项清单 extended, never a global magic.
//
// The stack-back direction lock is the C21 edge-swipe resolver itself (same
// 24dp activation / 10dp escape); F27 drops only its start-x band gate — the
// band stays as the official-session-screen fallback (visibility.ts 裁定 2).

import {
  resolveShellEdgeSwipeIntent,
  type ShellEdgeSwipeIntent,
} from "../session-header/edge-swipe";
import { DETAIL_ROOT_ROUTE } from "../routes";
import type { BackPriorityStateLike } from "../search/shell-back-priority";
import { resolveFilesSegmentSwipeIntent, type FilesSegmentPosture } from "./files-segment";
import { resolveRingSwipeIntent, type RingSwipeIntent } from "./tab-ring";

export type ShellSwipeRole = "stack-back" | "tab-ring" | "files-segment";

export interface ShellSwipeInput {
  deltaX: number;
  deltaY: number;
}

export interface ShellSwipeContext {
  /** A (detail)/official push owns the front screen → only stack-back is live. */
  stackInFront: boolean;
  /** The surface's own exclusion band (拖拽/搜索态/换页中). */
  blocked: boolean;
  /** 声明性豁免: a registered horizontal surface is scrolled right. */
  horizontalScrolled: boolean;
  /**
   * B8-FILESWIP (F29): set when THIS pan is the 文件页内层段 pager — the posture
   * (当前段/可滑段数) replaces the role branch below. 单仲裁器原则: the inner
   * decision is this function's frontmost consumer, not a second arbiter; its
   * boundary FAIL is what releases the same touch stream to the ancestor pan
   * (栈页=stack-back host 的 pop/恒 FAIL，tab 宿主=主环), and its ACTIVATION
   * cancels those ancestors (RNGH orchestrator `makeActive`).
   */
  segment?: FilesSegmentPosture;
}

export type ShellSwipeDecision =
  | { readonly role: "stack-back"; readonly intent: ShellEdgeSwipeIntent }
  | { readonly role: "tab-ring"; readonly intent: RingSwipeIntent }
  | { readonly role: "files-segment"; readonly intent: RingSwipeIntent };

const STACK_FAIL: ShellSwipeDecision = { role: "stack-back", intent: "fail" };
const RING_FAIL: ShellSwipeDecision = { role: "tab-ring", intent: "fail" };
const SEGMENT_FAIL: ShellSwipeDecision = { role: "files-segment", intent: "fail" };

/**
 * The single question every horizontal Pan asks mid-touch: whose swipe is this
 * and has it committed yet. Gates first (both roles lose to a blocked surface or
 * an exempt horizontal scroll), then the role's own direction lock.
 */
export function decideShellSwipe(
  input: ShellSwipeInput,
  ctx: ShellSwipeContext,
): ShellSwipeDecision {
  "worklet";
  if (ctx.blocked || ctx.horizontalScrolled) {
    if (ctx.segment) return SEGMENT_FAIL;
    return ctx.stackInFront ? STACK_FAIL : RING_FAIL;
  }
  // 内层段 pager 先决（F29）：它消费则消费；边界/灰段 = fail = 同流让位祖先面，
  // 让位是结构事实（RNGH：后代 fail 后祖先仍可激活），这里不需要知道祖先是谁。
  if (ctx.segment) {
    return { role: "files-segment", intent: resolveFilesSegmentSwipeIntent(input, ctx.segment) };
  }
  if (ctx.stackInFront) {
    return { role: "stack-back", intent: resolveShellEdgeSwipeIntent(input) };
  }
  return { role: "tab-ring", intent: resolveRingSwipeIntent(input) };
}

/**
 * Is the frontmost root-stack entry the (detail) group? The stack-back overlay
 * mounts inside that group's layout, which stays mounted while an OFFICIAL
 * screen is pushed on top of a detail screen — without this gate its full-width
 * Pan would race the capsule's edge band on the session screen.
 */
export function isDetailGroupFrontmost(state: BackPriorityStateLike | undefined): boolean {
  const focused = state ? state.routes[state.index ?? -1] : undefined;
  return focused?.name === DETAIL_ROOT_ROUTE;
}
