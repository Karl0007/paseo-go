// B8-SWIPE (批次八 F26+F27) — the ONE horizontal-swipe arbiter. Two verdicts
// share one state machine so they can never fight over the same touch:
//
//   role "tab-ring"   (root tab frontmost)   手指左滑=环前进 / 右滑=环后退
//   role "stack-back" (堆叠页 frontmost)      手指右滑=pop 返回，不限左缘带；
//                                             手指左滑 FAIL —— 堆叠页上左滑不切
//                                             tab（返回栈优先，F27 冻结口径）
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
import { resolveRingSwipeIntent, type RingSwipeIntent } from "./tab-ring";

export type ShellSwipeRole = "stack-back" | "tab-ring";

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
}

export type ShellSwipeDecision =
  | { readonly role: "stack-back"; readonly intent: ShellEdgeSwipeIntent }
  | { readonly role: "tab-ring"; readonly intent: RingSwipeIntent };

const STACK_FAIL: ShellSwipeDecision = { role: "stack-back", intent: "fail" };
const RING_FAIL: ShellSwipeDecision = { role: "tab-ring", intent: "fail" };

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
    return ctx.stackInFront ? STACK_FAIL : RING_FAIL;
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
