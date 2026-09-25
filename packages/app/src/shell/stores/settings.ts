// Shell-local settings (DESIGN.md §2.6): zustand + AsyncStorage persist, key prefix
// `paseoGo.`. `shellMode` is tri-state: null = user never toggled → bundle-time env
// default decides; a boolean = the runtime switch wins (seam priority, DESIGN §2.1).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { SHELL_MODE_ENV_DEFAULT } from "@/shell/config";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type ShellTab = "chats" | "workspace" | "me";

const PaseoGoSettingsPersistedSchema = z.strictObject({
  shellMode: z.boolean().nullable(),
  defaultTab: z.enum(["chats", "workspace", "me"]),
});

interface PaseoGoSettingsState {
  shellMode: boolean | null;
  defaultTab: ShellTab;
  setShellMode: (shellMode: boolean) => void;
  setDefaultTab: (tab: ShellTab) => void;
}

export const usePaseoGoSettingsStore = create<PaseoGoSettingsState>()(
  persist<PaseoGoSettingsState, [], [], z.infer<typeof PaseoGoSettingsPersistedSchema>>(
    (set) => ({
      shellMode: null,
      defaultTab: "chats",
      setShellMode: (shellMode) => set({ shellMode }),
      setDefaultTab: (defaultTab) => set({ defaultTab }),
    }),
    {
      name: "paseoGo.settings",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoSettingsPersistedSchema),
      partialize: (state) => ({ shellMode: state.shellMode, defaultTab: state.defaultTab }),
    },
  ),
);

/** Seam value read by `src/app/index.tsx`: runtime store wins, then env default. */
export function usePaseoGoShellActive(): boolean {
  const shellMode = usePaseoGoSettingsStore((state) => state.shellMode);
  return shellMode ?? SHELL_MODE_ENV_DEFAULT;
}
