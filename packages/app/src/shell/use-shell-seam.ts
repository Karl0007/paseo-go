// Startup seam gate (F2 review fix): the index dispatcher must not branch between
// shell IA and official IA until the shell settings store has rehydrated. The
// shell Redirect fires on the very first frame and unmounts Index, so a persisted
// `shellMode: false` would rehydrate into nobody — env-on packages could never
// leave shell mode. While `pending`, the seam renders the startup placeholder;
// onFinishHydration (the commands/edit.tsx posture) releases it.
//
// The failsafe timer covers zustand's storage-reject path: persist's hydrate()
// catch leaves hasHydrated false and never fires finish listeners, so a dead
// AsyncStorage must not brick startup forever — it degrades to the pre-F2
// env-default branch instead.
import { useEffect, useState } from "react";
import { SHELL_MODE_ENV_DEFAULT } from "@/shell/config";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";

const HYDRATION_FAILSAFE_MS = 2000;

export interface ShellSeam {
  /** True until the persisted settings have settled (hydrated, or failed). */
  pending: boolean;
  /** Seam value: runtime store wins, then the bundle-time env default. */
  active: boolean;
}

export function useShellSeam(): ShellSeam {
  const shellMode = usePaseoGoSettingsStore((state) => state.shellMode);
  const [pending, setPending] = useState(() => !usePaseoGoSettingsStore.persist.hasHydrated());
  useEffect(() => {
    if (!pending) return undefined;
    // Hydration may settle between the render and this effect — re-check first.
    if (usePaseoGoSettingsStore.persist.hasHydrated()) {
      setPending(false);
      return undefined;
    }
    const unsubscribe = usePaseoGoSettingsStore.persist.onFinishHydration(() => setPending(false));
    const failsafe = setTimeout(() => setPending(false), HYDRATION_FAILSAFE_MS);
    return () => {
      unsubscribe();
      clearTimeout(failsafe);
    };
  }, [pending]);
  return { pending, active: shellMode ?? SHELL_MODE_ENV_DEFAULT };
}
