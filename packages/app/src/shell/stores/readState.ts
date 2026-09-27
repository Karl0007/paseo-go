// Per-chat read timestamps (DESIGN.md §2.6, §4): C18 completion-based semantics —
// unread = the chat's last *attention* event (finished/error/permission) is newer
// than `lastReadAt[key]`; activity alone never marks unread, and a chat that never
// completed anything is not unread. Clearing on entry is C4's wiring — C2 owns the
// store and the derivation.
// F4 (review): stamps are caller-supplied host-domain event times — no device-clock
// default, which would compare across clock domains and mis-arm the unread dot.
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
  /** Row key is `${serverId}:${agentId}`; `at` is the chat's host-domain last-event
   *  stamp (chatLastEventAt family), never the device wall clock. */
  markRead: (key: string, at: number) => void;
  /** C3 delete cleanup: a deleted chat's read stamp must not outlive it. */
  clear: (key: string) => void;
  clearAll: () => void;
}

export const usePaseoGoReadStateStore = create<PaseoGoReadStateState>()(
  persist<PaseoGoReadStateState, [], [], z.infer<typeof PaseoGoReadStatePersistedSchema>>(
    (set) => ({
      lastReadAt: {},
      markRead: (key, at) => {
        // R2-14 entry guard: `at` is an untrusted derivation of host date
        // strings (protocol bare z.string()). The persisted schema is
        // int/nonnegative — a NaN/Infinity/negative stamp written here would
        // fail setItem validation, and validated-persist-storage answers that
        // by dropping the WHOLE store (the R2-13 eviction chain). Refuse the
        // bad watermark instead: the row keeps its previous stamp.
        if (!Number.isSafeInteger(at) || at < 0) {
          console.warn("[readState] markRead dropped non-stamp watermark", { key, at });
          return;
        }
        set((state) => ({
          lastReadAt: { ...state.lastReadAt, [key]: at },
        }));
      },
      clear: (key) =>
        set((state) => {
          if (!(key in state.lastReadAt)) return state;
          const next = { ...state.lastReadAt };
          delete next[key];
          return { lastReadAt: next };
        }),
      clearAll: () => set({ lastReadAt: {} }),
    }),
    {
      name: "paseoGo.readState",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoReadStatePersistedSchema),
      partialize: (state) => ({ lastReadAt: state.lastReadAt }),
    },
  ),
);
