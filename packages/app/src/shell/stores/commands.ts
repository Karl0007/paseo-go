// 快捷指令 store (DESIGN §2.6/§5 D1, card C7): zustand + AsyncStorage persist under
// `paseoGo.commands`, the commands.ts pattern the favorites store established
// (validated persist, partialize to the data slice). Identity is the generated id —
// unlike favorites there is no natural dedup key (two commands may share name and
// prompt), so add always appends a fresh entry; update/remove address by id.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const ShellCommandSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  hostId: z.string().min(1),
  /** Absent = 每次运行时询问 (the picker sheet fires on tap). */
  workspaceId: z.string().min(1).optional(),
  /** `"provider"` or `"provider/model"`; absent = host default resolution at run time. */
  providerModel: z.string().min(1).optional(),
  prompt: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

export type ShellCommand = z.infer<typeof ShellCommandSchema>;

/** Everything the form owns; id/createdAt are the store's to mint (on add). */
export interface ShellCommandInput {
  name: string;
  hostId: string;
  workspaceId?: string | null;
  providerModel?: string | null;
  prompt: string;
}

const PaseoGoCommandsPersistedSchema = z.strictObject({
  items: z.array(ShellCommandSchema),
});

interface PaseoGoCommandsState {
  items: ShellCommand[];
  /** Mints id + createdAt; returns the new id so callers can navigate or undo. */
  addCommand: (input: ShellCommandInput, at?: number) => string;
  /** Patch by id; null/undefined fields in the patch clear the optional ones. */
  updateCommand: (id: string, patch: ShellCommandInput) => void;
  removeCommand: (id: string) => void;
  clearAll: () => void;
}

// Mirrors the official idiom (workspace-layout-ids): crypto.randomUUID where the
// polyfill provides it, timestamp+random fallback so a missing crypto never blocks
// a save. `cmd-` keeps shell ids visually distinct in daemon-side logs.
function createCommandId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `cmd-${value}`;
}

function toStoredCommand(input: ShellCommandInput, id: string, createdAt: number): ShellCommand {
  return {
    id,
    name: input.name,
    hostId: input.hostId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.providerModel ? { providerModel: input.providerModel } : {}),
    prompt: input.prompt,
    createdAt,
  };
}

export const usePaseoGoCommandsStore = create<PaseoGoCommandsState>()(
  persist<PaseoGoCommandsState, [], [], z.infer<typeof PaseoGoCommandsPersistedSchema>>(
    (set) => ({
      items: [],
      addCommand: (input, at) => {
        const id = createCommandId();
        const entry = toStoredCommand(input, id, at ?? Date.now());
        set((state) => ({ items: [entry, ...state.items] }));
        return id;
      },
      updateCommand: (id, patch) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? toStoredCommand(patch, id, item.createdAt) : item,
          ),
        })),
      removeCommand: (id) =>
        set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      clearAll: () => set({ items: [] }),
    }),
    {
      name: "paseoGo.commands",
      storage: createValidatedPersistStorage(AsyncStorage, PaseoGoCommandsPersistedSchema),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
