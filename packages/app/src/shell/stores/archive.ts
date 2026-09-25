// Shell-local archive (DESIGN.md §2.6, §4): archived chats hide from the list by
// default; the top-bar filter toggle that reveals them lands with the C3 long-press
// menu that archives. C2 owns the store and the list-side hiding.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const PaseoGoArchivePersistedSchema = z.strictObject({
  archivedIds: z.array(z.string()),
});

interface PaseoGoArchiveState {
  archivedIds: string[];
  /** Row key is `${serverId}:${agentId}`. */
  archive: (key: string) => void;
  unarchive: (key: string) => void;
}

export const usePaseoGoArchiveStore = create<PaseoGoArchiveState>()(
  persist<PaseoGoArchiveState, [], [], z.infer<typeof PaseoGoArchivePersistedSchema>>(
    (set) => ({
      archivedIds: [],
      archive: (key) =>
        set((state) =>
          state.archivedIds.includes(key) ? state : { archivedIds: [...state.archivedIds, key] },
        ),
      unarchive: (key) =>
        set((state) => ({ archivedIds: state.archivedIds.filter((id) => id !== key) })),
    }),
    {
      name: "paseoGo.archive",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoArchivePersistedSchema),
      partialize: (state) => ({ archivedIds: state.archivedIds }),
    },
  ),
);
