// Persisted half of the update notice (M4 slice 2): which release version the user
// has already been shown (banner 一次性 semantics — 同版本只提示一次). Only this
// survives restarts; check results themselves are per-session (update/state.ts).
// `seenVersion` stores the bare go version (`0.10.2-go.6`), not the tag.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const UpdateNoticePersistedSchema = z.strictObject({
  // `.default` keeps pre-M4 payloads (no key) valid — same envelope-evolution
  // discipline as settings.notifications (C11).
  seenVersion: z.string().nullable().default(null),
});

interface UpdateNoticeState {
  seenVersion: string | null;
  markSeen: (version: string) => void;
}

export const usePaseoGoUpdateNoticeStore = create<UpdateNoticeState>()(
  persist<UpdateNoticeState, [], [], z.infer<typeof UpdateNoticePersistedSchema>>(
    (set) => ({
      seenVersion: null,
      markSeen: (version) => set({ seenVersion: version }),
    }),
    {
      name: "paseoGo.updateNotice",
      storage: createValidatedPersistStorage(AsyncStorage, UpdateNoticePersistedSchema),
      partialize: (state) => ({ seenVersion: state.seenVersion }),
    },
  ),
);
