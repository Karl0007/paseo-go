// C31 section-focus bus (DESIGN-tablet §3.2/§4-2): the C18 markRead 双拍's second
// beat fires when a shell tab screen regains focus. Since C31 the list bodies live
// in TWO positions — inside the tab screen (compact) and inside the tablet split's
// left column (wide), and the column sits OUTSIDE every navigator, where
// useFocusEffect cannot be called. So the thin tab screens (always inside the
// navigator, placeholder or body) translate the real focus event into a per-section
// beat on this bus, and each body subscribes. A module-level listener set keeps the
// bus free of refs into screens it does not own — the rail-events posture.
//
// React-free and unit-testable like rail-events; `ShellTab` is the section identity
// (chats | workspace | me).
import type { ShellTab } from "@/shell/stores/settings";

export type SectionFocusListener = () => void;

const listeners = new Map<ShellTab, Set<SectionFocusListener>>();

export function subscribeSectionFocus(tab: ShellTab, listener: SectionFocusListener): () => void {
  let set = listeners.get(tab);
  if (!set) {
    set = new Set();
    listeners.set(tab, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function emitSectionFocus(tab: ShellTab): void {
  const set = listeners.get(tab);
  if (!set) return;
  // Set iteration is delete-safe (an unsubscribing listener is simply skipped);
  // a body mounting mid-beat joins the same beat — the desired cold-mount语义.
  for (const listener of set) listener();
}
