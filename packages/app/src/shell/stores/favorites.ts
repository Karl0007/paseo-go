// 文件收藏 store (DESIGN §2.6/§5, card C6): zustand + AsyncStorage persist under
// `paseoGo.favorites`. Identity is hostId+path — re-favoriting an existing file
// refreshes its snapshot metadata (name/size/mtime, the ruling's dedup fields) and
// moves it to the front instead of double-listing. workspaceId/workspaceRoot ride
// along so the 工作区 tab can resolve a favorite back to a preview push even when
// the workspace descriptor has not synced yet (offline host, archived project).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const ShellFavoriteSchema = z.strictObject({
  hostId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceRoot: z.string(),
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtime: z.string(),
  addedAt: z.number().int().nonnegative(),
});

export type ShellFavoriteFile = z.infer<typeof ShellFavoriteSchema>;

export interface ShellFavoriteInput {
  hostId: string;
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  name: string;
  size?: number;
  mtime?: string;
}

const PaseoGoFavoritesPersistedSchema = z.strictObject({
  items: z.array(ShellFavoriteSchema),
});

interface PaseoGoFavoritesState {
  items: ShellFavoriteFile[];
  /** Dedup key hostId+path: existing entries refresh metadata and jump to front. */
  addFavorite: (input: ShellFavoriteInput, at?: number) => void;
  removeFavorite: (hostId: string, path: string) => void;
  clearAll: () => void;
}

export const usePaseoGoFavoritesStore = create<PaseoGoFavoritesState>()(
  persist<PaseoGoFavoritesState, [], [], z.infer<typeof PaseoGoFavoritesPersistedSchema>>(
    (set) => ({
      items: [],
      addFavorite: (input, at) =>
        set((state) => {
          const entry: ShellFavoriteFile = {
            hostId: input.hostId,
            workspaceId: input.workspaceId,
            workspaceRoot: input.workspaceRoot,
            path: input.path,
            name: input.name,
            size: input.size ?? 0,
            mtime: input.mtime ?? "",
            addedAt: at ?? Date.now(),
          };
          const rest = state.items.filter(
            (item) => !(item.hostId === entry.hostId && item.path === entry.path),
          );
          return { items: [entry, ...rest] };
        }),
      removeFavorite: (hostId, path) =>
        set((state) => ({
          items: state.items.filter((item) => !(item.hostId === hostId && item.path === path)),
        })),
      clearAll: () => set({ items: [] }),
    }),
    {
      name: "paseoGo.favorites",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoFavoritesPersistedSchema),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

export function isFavoritePath(items: ShellFavoriteFile[], hostId: string, path: string): boolean {
  return items.some((item) => item.hostId === hostId && item.path === path);
}
