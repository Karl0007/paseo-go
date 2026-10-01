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
// shellAgentActions.remove, same lifecycle as readState/forkAck — and B5-REVIEW
// A4 closes the other half: a chat deleted on ANOTHER device never fires the
// local remove, so its entry now prunes at fold time after N consecutive
// ABSENCES from COMPLETE directory ticks (pruneAbsent). The completeness gates
// are the whole point — a transient empty directory, a reconnecting host, or an
// OFFLINE host must never wipe the memory this fix exists to protect.
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
  /** B5-REVIEW A4: consecutive COMPLETE ticks each key was absent for.
   *  Memory-only — partialize persists `previews` alone. */
  absentStreaks: Record<string, number>;
  /** Fold one directory observation. Blank never clears; same value never churns
   *  the store (the screen folds on every directory tick). */
  remember: (key: string, preview: string | null | undefined) => void;
  /** C3 delete cleanup: a deleted chat's remembered preview must not outlive it. */
  forget: (key: string) => void;
  /**
   * B5-REVIEW A4: fold a COMPLETE directory tick — forget keys absent from
   * ABSENCE_PRUNE_TICKS consecutive such ticks (a chat deleted on another
   * device). Every gate is a false-wipe guard: `complete` false (empty
   * directory = loading/reconnect churn) counts nothing; a key whose server
   * was not observed this tick (offline/reconnecting host — its rows are
   * legitimately absent) neither counts nor resets; a present key resets its
   * streak. Identity-stable when nothing changes (the screen folds on every
   * tick).
   */
  pruneAbsent: (tick: {
    complete: boolean;
    present: ReadonlySet<string>;
    isServerObserved: (key: string) => boolean;
  }) => void;
  clearAll: () => void;
}

/** N>=2: one flaky tick is never a deletion (the reviewer's ruling). */
const ABSENCE_PRUNE_TICKS = 2;

export const usePaseoGoStickyPreviewStore = create<PaseoGoStickyPreviewState>()(
  persist<PaseoGoStickyPreviewState, [], [], z.infer<typeof PaseoGoStickyPreviewPersistedSchema>>(
    (set) => ({
      previews: {},
      absentStreaks: {},
      remember: (key, preview) => {
        const value = (preview ?? "").trim();
        if (value.length === 0) return;
        set((state) =>
          state.previews[key] === value ? state : { previews: { ...state.previews, [key]: value } },
        );
      },
      forget: (key) =>
        set((state) => {
          if (!(key in state.previews) && !(key in state.absentStreaks)) return state;
          const next = { ...state.previews };
          delete next[key];
          const streaks = { ...state.absentStreaks };
          delete streaks[key];
          return { previews: next, absentStreaks: streaks };
        }),
      pruneAbsent: ({ complete, present, isServerObserved }) => {
        if (!complete) return;
        set((state) => {
          let previews: Record<string, string> | null = null;
          let streaks: Record<string, number> | null = null;
          for (const key of Object.keys(state.previews)) {
            if (present.has(key)) {
              if (state.absentStreaks[key] !== undefined) {
                streaks ??= { ...state.absentStreaks };
                delete streaks[key];
              }
              continue;
            }
            if (!isServerObserved(key)) continue;
            const streak = (state.absentStreaks[key] ?? 0) + 1;
            if (streak >= ABSENCE_PRUNE_TICKS) {
              previews ??= { ...state.previews };
              delete previews[key];
              streaks ??= { ...state.absentStreaks };
              delete streaks[key];
            } else {
              streaks ??= { ...state.absentStreaks };
              streaks[key] = streak;
            }
          }
          if (!previews && !streaks) return state;
          return {
            ...(previews ? { previews } : {}),
            ...(streaks ? { absentStreaks: streaks } : {}),
          };
        });
      },
      clearAll: () => set({ previews: {}, absentStreaks: {} }),
    }),
    {
      name: "paseoGo.stickyPreview",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoStickyPreviewPersistedSchema),
      partialize: (state) => ({ previews: state.previews }),
    },
  ),
);
