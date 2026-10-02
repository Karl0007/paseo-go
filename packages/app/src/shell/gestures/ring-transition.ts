// B8-SWIPE (F26) — the ring's cross-tab hand-off bus. A ring commit that leaves
// the current tab cannot animate the incoming screen from where it stands: the
// outgoing surface parks at its exit wall, the official tab verb (`router.
// navigate(SHELL.*)`, the rail's own verb) swaps screens, and the NEWLY focused
// screen must play the entrance from the opposite wall. Two module-level pieces
// carry that across the navigator boundary, the `lastFocusedTab` / section-focus
// posture (React-free, unit-testable, no refs into screens the bus does not own):
//
//   pending transition — armed by the exiting screen right before it navigates;
//     consumed by the first focus beat of the TARGET section (or by the target
//     hook's mount effect when the beat lands before it subscribed — bottom-tabs
//     lazy-mounts unvisited tabs).
//   frontmost section  — written by the (shell) layout's navigation listener
//     (the ONLY place that sees tab focus on compact AND wide, since the split
//     column lives outside every navigator). `null` while a (detail)/official
//     push owns the screen: the ring hook fails its gate on it, which is the
//     runtime half of 堆叠页返回优先 (F27) — a right-swipe on a stack page is
//     never a tab-ring retreat.
//
// One notification stream serves both: listeners re-read `getShellFrontmostSection`
// semantics through the argument (the focused section or null).

import type { ShellTab } from "../stores/settings";
import { ringSectionForSlot, type RingDirection, type RingSlot } from "./tab-ring";

export interface RingTransition {
  readonly target: RingSlot;
  readonly direction: RingDirection;
}

let pending: RingTransition | null = null;
let frontmost: ShellTab | null = null;

export type ShellFrontmostListener = (section: ShellTab | null) => void;

const listeners = new Set<ShellFrontmostListener>();

/** 出场拍落地前挂上「下一格从哪面墙进」；新的 arm 直接替换旧的（同一时刻只可能有一次环换页）。 */
export function armRingTransition(transition: RingTransition): void {
  pending = transition;
}

/** 目标 section 的焦点拍取走属于自己的 pending；别的 section 的拍不吞（留到它自己聚焦）。 */
export function consumeRingTransitionForSection(section: ShellTab): RingTransition | null {
  if (pending === null || ringSectionForSlot(pending.target) !== section) return null;
  const taken = pending;
  pending = null;
  return taken;
}

/**
 * The (shell) layout calls this on EVERY navigation-state change with the
 * focused tab (null while a (detail)/official screen is on top). Deduped: a beat
 * only fires when the front actually moved, so unrelated state churn can never
 * interrupt a playing entrance.
 */
export function setShellFrontmostSection(section: ShellTab | null): void {
  if (frontmost === section) return;
  frontmost = section;
  // Set iteration is delete-safe (the section-focus precedent).
  for (const listener of listeners) listener(section);
}

export function getShellFrontmostSection(): ShellTab | null {
  return frontmost;
}

export function subscribeShellFrontmost(listener: ShellFrontmostListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
