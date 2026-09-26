// Pinned chats + shell-local ordering (DESIGN.md §2.6, §4): zustand + AsyncStorage
// persist, key prefix `paseoGo.`. `pinnedIds` is the display order of the 置顶 group
// (C3 wires the in-group drag via `setOrder`; C20 adds `pinAt` — a drop from outside
// the group pins the row and inserts it at the drop slot).
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
  /**
   * C20 (DESIGN §14.4): drop a row into the 置顶 group at `index` — pins
   * unpinned rows and moves already-pinned ones. `index` is the position
   * WITHIN the group (see `pinnedDropIndex` for the flat-list conversion) and
   * is clamped to [0, length], so a drop past either edge lands on that edge.
   */
  pinAt: (key: string, index: number) => void;
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
      pinAt: (key, index) =>
        set((state) => {
          const next = state.pinnedIds.filter((id) => id !== key);
          next.splice(Math.max(0, Math.min(next.length, Math.trunc(index))), 0, key);
          return { pinnedIds: next };
        }),
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

/**
 * C20: convert a drop position in the flat visible list into an insertion index
 * INSIDE the 置顶 group (the group-offset conversion the drag drop needs).
 * `visibleRowKeys` are the row keys in post-drop render order — section headers
 * excluded, they carry no pin opinion; `droppedKey` is the dragged row. The
 * index counts pinned rows above the drop slot, so rows of the other groups
 * only contribute to the offset, never to the count. A drop below the group
 * saturates the count and clamps to the group tail by construction; a drop
 * above its first row yields 0. Pins hidden from the directory (stale keys not
 * in `visibleRowKeys`) are not counted — the index is relative to visible rows.
 */
export function pinnedDropIndex(input: {
  droppedKey: string;
  visibleRowKeys: readonly string[];
  pinnedIds: readonly string[];
}): number {
  const pinned = new Set(input.pinnedIds);
  let index = 0;
  for (const key of input.visibleRowKeys) {
    if (key === input.droppedKey) break;
    if (pinned.has(key)) index += 1;
  }
  return index;
}
