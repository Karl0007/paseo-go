// C24 fork-warning acknowledgement (DESIGN §14.10, card C24): opening an imported
// provider session for the first time warns that continuing from the app forks the
// source when it still runs on the PC. Confirming once per chat persists the ack
// here, so the warning is exactly-once per row key. Shell-local like archive/pins:
// the `paseoGo.forkAck` envelope rides clear-local-data and the delete sweep.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const PaseoGoForkAckPersistedSchema = z.strictObject({
  ackedKeys: z.array(z.string()),
});

interface PaseoGoForkAckState {
  ackedKeys: string[];
  /** Row key is `${serverId}:${agentId}`. Idempotent (the archive-store posture). */
  ack: (key: string) => void;
  /** C24 delete cleanup: a deleted chat's ack must not outlive it. */
  clear: (key: string) => void;
}

export const usePaseoGoForkAckStore = create<PaseoGoForkAckState>()(
  persist<PaseoGoForkAckState, [], [], z.infer<typeof PaseoGoForkAckPersistedSchema>>(
    (set) => ({
      ackedKeys: [],
      ack: (key) =>
        set((state) =>
          state.ackedKeys.includes(key) ? state : { ackedKeys: [...state.ackedKeys, key] },
        ),
      clear: (key) => set((state) => ({ ackedKeys: state.ackedKeys.filter((id) => id !== key) })),
    }),
    {
      name: "paseoGo.forkAck",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoForkAckPersistedSchema),
      partialize: (state) => ({ ackedKeys: state.ackedKeys }),
    },
  ),
);
