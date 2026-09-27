// C30 reactive half of the split host: seam × window width × pathname → activation.
// All judgement lives in split-predicates (pure, unit-tested); this hook only
// subscribes to the live sources (§6 R-1: zustand-backed seam, router pathname —
// no version-counter recomputes, no useUnistyles per docs/unistyles.md).
// C31-F1 (C32 增补裁定 5): the compact signal is `useShellWindowCompact()` —
// window dimensions, NOT the Unistyles breakpoint, which stays stale across a
// runtime portrait→landscape rotation (device-proven). The rail/list widths come
// from the same source (form-factor), so activation and geometry flip in one
// frame — no "split on, widths old" half-updated state.
// The `pending` gate mirrors the F2 posture (R-2/KI3): until settings rehydrate
// the host stays passthrough, so a cold landscape start can never flash the
// split before the shell decision has settled.
import { usePathname } from "expo-router";
import { useRef } from "react";
import { useShellSeam } from "@/shell/use-shell-seam";
import { useShellWindowCompact } from "./form-factor";
import {
  isFullBleedPathname,
  shouldActivateTabletSplit,
  tabletSectionForPathname,
  type TabletSection,
} from "./split-predicates";

export interface TabletSplitState {
  active: boolean;
  /** Live rail section; held across `/h/…`, `/import`, `/commands/edit`,
   * `/rename`, `/preview` (§3.2-2). */
  section: TabletSection;
}

export function useTabletSplit(): TabletSplitState {
  const { pending, active: shellActive } = useShellSeam();
  const isCompact = useShellWindowCompact();
  const pathname = usePathname();
  const lastSection = useRef<TabletSection>("chats");
  const derived = tabletSectionForPathname(pathname);
  if (derived) lastSection.current = derived;
  const fullBleed = isFullBleedPathname(pathname);
  const active = !pending && shouldActivateTabletSplit({ shellActive, isCompact, fullBleed });
  return {
    active,
    section: lastSection.current,
  };
}
