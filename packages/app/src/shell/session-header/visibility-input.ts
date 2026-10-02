// C14 visibility input — the React half, extracted (REVIEW-B8-14) so the capsule
// overlay AND the session screen's ancestor edge-back host read the exact same
// gate inputs. The predicates themselves stay pure (`visibility.ts`); this hook
// only assembles the input from live sources:
//
// - `usePaseoGoShellActive`: runtime switch wins over the env default (seam).
// - `usePathname`: global pathname; every push/pop re-renders the consumers.
// - `useRootNavigation`: the layout component is not a screen, so neither
//   useRootNavigationState nor the ambient useNavigation context is dependable
//   here. The navigation CONTAINER's state has one `__root` route whose nested
//   state IS the app Stack — the array carrying the `(shell)` / `h/[serverId]`
//   entries.
// - `selectIsCompactFileExplorerOpen` (C21 yield): the compact explorer overlay
//   paints its own top rail; wide opens a pane and never flips mobilePanel.
// - `useShellWindowCompact` (C31-F1/C32): window-dimension source, NOT the
//   Unistyles breakpoint (which stays stale across a runtime rotation).
import { useMemo } from "react";
import { usePathname, useRootNavigation } from "expo-router";
import { selectIsCompactFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import { usePaseoGoShellActive } from "@/shell/stores/settings";
import { useShellWindowCompact } from "@/shell/tablet/form-factor";
import type { ShellSessionVisibilityInput } from "./visibility";

export function useShellSessionVisibilityInput(): ShellSessionVisibilityInput {
  const shellActive = usePaseoGoShellActive();
  const pathname = usePathname();
  const explorerOverlayOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  const rootState = useRootNavigation()?.getState()?.routes[0]?.state;
  const isCompact = useShellWindowCompact();

  return useMemo(
    () => ({
      shellMode: shellActive,
      pathname,
      rootRoutes: (rootState?.routes ?? []).map((route) => route.name),
      rootIndex: rootState?.index ?? -1,
      explorerOverlayOpen,
      isCompact,
    }),
    [shellActive, pathname, rootState, explorerOverlayOpen, isCompact],
  );
}
