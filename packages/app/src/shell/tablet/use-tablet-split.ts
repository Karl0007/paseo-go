// C30 reactive half of the split host: seam × breakpoint × pathname → activation.
// All judgement lives in split-predicates (pure, unit-tested); this hook only
// subscribes to the live sources (§6 R-1: zustand-backed seam, the official
// breakpoint hook, router pathname — no version-counter recomputes, no
// useUnistyles per docs/unistyles.md). Widths are NOT this hook's business:
// metrics.ts feeds breakpoint-keyed style values, so the §4 table re-renders
// nothing on rotation.
// The `pending` gate mirrors the F2 posture (R-2/KI3): until settings rehydrate
// the host stays passthrough, so a cold landscape start can never flash the
// split before the shell decision has settled.
import { usePathname } from "expo-router";
import { useRef } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShellSeam } from "@/shell/use-shell-seam";
import {
  isFullBleedPathname,
  shouldActivateTabletSplit,
  tabletSectionForPathname,
  type TabletSection,
} from "./split-predicates";

export interface TabletSplitState {
  active: boolean;
  /** Live rail section; held across `/h/…`, `/import`, `/commands/edit` (§3.2-2). */
  section: TabletSection;
}

export function useTabletSplit(): TabletSplitState {
  const { pending, active: shellActive } = useShellSeam();
  const isCompact = useIsCompactFormFactor();
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
