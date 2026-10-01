// B5-SUB (批次五 F13) — the shell's keep-old-value memory for the row subtitle.
//
// Why this exists (evidence/B5-SUB/ws-frames-before.txt): the daemon's directory
// serves `lastMessagePreview: null` for every agent whose stored record predates
// B4-PREVIEW — the list path flattens "not derived yet" into "no messages" — and
// the client's directory merge is a whole-object replace (replaceFetched /
// acceptAgentDirectoryUpdate), so one pull-to-refresh, tab-focus revalidation or
// devd restart wipes the preview the row has been showing. The official merge is
// out of bounds; the card's ruling is 壳侧兜底保留旧值: the shell remembers the
// last non-blank preview per chat and the row falls back to it (row-title's
// selectSubtitlePreview) whenever the directory goes blank.
//
// Once seen, never lost: the store persists (AsyncStorage), so a preview derived
// by one session open (the daemon re-derives it from the durable timeline on
// resume) survives daemon AND app restarts. A deleted chat's entry is cleared by
// shellAgentActions.remove, same lifecycle as readState/forkAck.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const PaseoGoStickyPreviewPersistedSchema = z.strictObject({
  previews: z.record(z.string(), z.string()),
});

interface PaseoGoStickyPreviewState {
  /** Last non-blank `lastMessagePreview` seen, keyed `${serverId}:${agentId}`. */
  previews: Record<string, string>;
  /** Fold one directory observation. Blank never clears; same value never churns
   *  the store (the screen folds on every directory tick). */
  remember: (key: string, preview: string | null | undefined) => void;
  /** C3 delete cleanup: a deleted chat's remembered preview must not outlive it. */
  forget: (key: string) => void;
  clearAll: () => void;
}

export const usePaseoGoStickyPreviewStore = create<PaseoGoStickyPreviewState>()(
  persist<PaseoGoStickyPreviewState, [], [], z.infer<typeof PaseoGoStickyPreviewPersistedSchema>>(
    (set) => ({
      previews: {},
      remember: (key, preview) => {
        const value = (preview ?? "").trim();
        if (value.length === 0) return;
        set((state) =>
          state.previews[key] === value ? state : { previews: { ...state.previews, [key]: value } },
        );
      },
      forget: (key) =>
        set((state) => {
          if (!(key in state.previews)) return state;
          const next = { ...state.previews };
          delete next[key];
          return { previews: next };
        }),
      clearAll: () => set({ previews: {} }),
    }),
    {
      name: "paseoGo.stickyPreview",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoStickyPreviewPersistedSchema),
      partialize: (state) => ({ previews: state.previews }),
    },
  ),
);
