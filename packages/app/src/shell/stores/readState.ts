// Per-chat read timestamps (DESIGN.md §2.6, §4): unread = the chat's last event is
// newer than `lastReadAt[key]`; a chat never opened has no record and counts as
// unread. Clearing on entry is C4's wiring — C2 owns the store and the derivation.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const PaseoGoReadStatePersistedSchema = z.strictObject({
  lastReadAt: z.record(z.string(), z.number().int().nonnegative()),
});

interface PaseoGoReadStateState {
  lastReadAt: Record<string, number>;
  /** Row key is `${serverId}:${agentId}`; `at` defaults to now (epoch ms). */
  markRead: (key: string, at?: number) => void;
  clearAll: () => void;
}

export const usePaseoGoReadStateStore = create<PaseoGoReadStateState>()(
  persist<PaseoGoReadStateState, [], [], z.infer<typeof PaseoGoReadStatePersistedSchema>>(
    (set) => ({
      lastReadAt: {},
      markRead: (key, at) =>
        set((state) => ({
          lastReadAt: { ...state.lastReadAt, [key]: at ?? Date.now() },
        })),
      clearAll: () => set({ lastReadAt: {} }),
    }),
    {
      name: "paseoGo.readState",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoReadStatePersistedSchema),
      partialize: (state) => ({ lastReadAt: state.lastReadAt }),
    },
  ),
);
