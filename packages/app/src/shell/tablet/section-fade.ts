// KI-9 切栏淡入 — the pure half. The wide list column keeps every visited
// section's body mounted (C15/C31 keep-alive: opacity 0 + pointerEvents none,
// never display:none — GONE resets Android scroll offsets), so a rail switch is
// an OPACITY crossfade between the outgoing and incoming panes, not a remount.
// This module owns the decision table; list-column.tsx only feeds Animated.Value
// targets through Animated.timing. The duration is shared with the compact
// bottom-tabs fade (bottom-tabs v7 FadeSpec is a 150ms timing natively — the
// two form factors land on the same beat by construction).
import type { TabletSection } from "./split-predicates";

/** Crossfade length for a rail section switch (and the compact tab fade). */
export const SECTION_FADE_MS = 150;

/**
 * Opacity targets for one switch: the incoming section fades to 1, every other
 * visited pane fades to 0. Sections absent from `visited` are not mounted and
 * get 0 (their Animated.Value is created at 0 on mount, so the first timing to
 * 1 IS the fade-in — no cold frame at full opacity, no flash).
 */
export function paneFadeTargets(
  visited: readonly TabletSection[],
  active: TabletSection,
): Record<TabletSection, 0 | 1> {
  const targets = { chats: 0, workspace: 0, me: 0 } as Record<TabletSection, 0 | 1>;
  for (const section of visited) targets[section] = section === active ? 1 : 0;
  return targets;
}
