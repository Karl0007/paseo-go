// B8-SWIPE (F27) — the declarative stack-back exemption bus. The full-width
// right-swipe overlay lives in the (detail) group layout, OUTSIDE every screen,
// so a screen cannot hand it a `blocked` prop; it DECLARES its exclusion instead
// (the card's 声明性豁免 posture — no global magic): while a search morph or a
// modal sheet owns the front screen, 右滑返回 is off (搜索态除外, 冻结口径).
//
// Keyed by surface so two claimants compose by union and each releases only its
// own key; the effect cleanup is the release, so an unmount can never strand the
// gate. React-free and unit-testable, the ring-transition/section-focus posture.

const blockedKeys = new Set<string>();

const listeners = new Set<() => void>();

/** `key` 声明/解除本屏的返回豁免；幂等，状态未变不通知。 */
export function setStackBackBlocked(key: string, blocked: boolean): void {
  const had = blockedKeys.has(key);
  if (had === blocked) return;
  if (blocked) blockedKeys.add(key);
  else blockedKeys.delete(key);
  for (const listener of listeners) listener();
}

export function isStackBackBlocked(): boolean {
  return blockedKeys.size > 0;
}

export function subscribeStackBackBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
