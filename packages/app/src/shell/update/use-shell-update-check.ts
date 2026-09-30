// Startup update probe (M4 slice 2), mounted by (shell)/_layout so it runs wherever
// the shell UI runs. One probe per JS context: the tabs layout remounts on theme
// switches (AppearanceStyleBoundary) and a per-hook ref would re-fire there — the
// module flag dies with the JS context, i.e. exactly one probe per app launch
// (same discipline as the notify ledger). Failures are silent by design: the 我的
// row stays the visible retry affordance.
import { useEffect } from "react";
import { useShellUpdateStore } from "./state";

let autoCheckStarted = false;

export function useShellUpdateCheck(): void {
  useEffect(() => {
    if (autoCheckStarted) return;
    autoCheckStarted = true;
    void useShellUpdateStore.getState().runCheck();
  }, []);
}
