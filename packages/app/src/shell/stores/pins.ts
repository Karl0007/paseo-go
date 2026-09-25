// Pinned chats + shell-local ordering (DESIGN.md §2.6, §4): zustand + AsyncStorage
// persist, key prefix `paseoGo.`. `pinnedIds` is the display order of the 置顶 group
// (C3 wires the drag that mutates it via `setOrder`; C2 only reads the order).
// `aliases` reserves the shell-local rename slot (C3 long-press menu) so the persisted
// shape never needs a migration when it lands.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const PaseoGoPinsPersistedSchema = z.strictObject({
  pinnedIds: z.array(z.string()),
  aliases: z.record(z.string(), z.string()),
});

interface PaseoGoPinsState {
  pinnedIds: string[];
  aliases: Record<string, string>;
  /** Row key is `${serverId}:${agentId}` — the same key the list uses. */
  togglePin: (key: string, pinned?: boolean) => void;
  /** C3 drag-and-drop lands here; C2 keeps the store primitive ready. */
  setOrder: (orderedIds: string[]) => void;
  /** C3 rename lands here; null clears the alias (official title wins again). */
  setAlias: (key: string, alias: string | null) => void;
}

export const usePaseoGoPinsStore = create<PaseoGoPinsState>()(
  persist<PaseoGoPinsState, [], [], z.infer<typeof PaseoGoPinsPersistedSchema>>(
    (set) => ({
      pinnedIds: [],
      aliases: {},
      togglePin: (key, pinned) =>
        set((state) => {
          const has = state.pinnedIds.includes(key);
          const wanted = pinned ?? !has;
          if (wanted === has) return state;
          return {
            pinnedIds: wanted
              ? [...state.pinnedIds, key]
              : state.pinnedIds.filter((id) => id !== key),
          };
        }),
      setOrder: (orderedIds) => set({ pinnedIds: [...orderedIds] }),
      setAlias: (key, alias) =>
        set((state) => {
          const next = { ...state.aliases };
          if (alias === null) delete next[key];
          else next[key] = alias;
          return { aliases: next };
        }),
    }),
    {
      name: "paseoGo.pins",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoPinsPersistedSchema),
      partialize: (state) => ({ pinnedIds: state.pinnedIds, aliases: state.aliases }),
    },
  ),
);
