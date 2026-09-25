// C8 acceptance (清除数据范围): the clear deletes exactly the `paseoGo.*` persist
// envelopes — official `@paseo:*` state and any foreign key survive — and the
// in-memory reset leaves every shell store at defaults with the shell-mode seam
// pinned false (the「删后回官方 IA」contract under an env-default-on dev bundle).
import { beforeEach, describe, expect, it, vi } from "vitest";

// Writes hit the Map synchronously (the promise only satisfies the API shape), so
// zustand persist's fire-and-forget writes are observable the instant setState
// returns — beforeEach can wipe the store deterministically without timer waits.
vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
        return Promise.resolve();
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
        return Promise.resolve();
      }),
      getAllKeys: vi.fn(() => Promise.resolve([...storage.keys()])),
      multiRemove: vi.fn((keys: string[]) => {
        for (const key of keys) storage.delete(key);
        return Promise.resolve();
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoCommandsStore } from "@/shell/stores/commands";
import { clearPaseoGoLocalData, resetShellStores } from "@/shell/stores/clear-local-data";
import { usePaseoGoFavoritesStore } from "@/shell/stores/favorites";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";

const SHELL_KEYS = ["paseoGo.settings", "paseoGo.favorites", "paseoGo.commands"];
const OFFICIAL_KEYS = ["@paseo:app-settings", "@paseo:settings-migrations", "some-foreign-key"];

beforeEach(async () => {
  resetShellStores(); // synchronous under the sync mock
  for (const key of await AsyncStorage.getAllKeys()) {
    if (key !== null) await AsyncStorage.removeItem(key);
  }
});

describe("clearPaseoGoLocalData scope", () => {
  it("deletes every paseoGo.* key and nothing else", async () => {
    for (const key of [...SHELL_KEYS, ...OFFICIAL_KEYS]) {
      await AsyncStorage.setItem(key, "{}");
    }
    const removed = [...(await clearPaseoGoLocalData())].sort();
    expect(removed).toEqual([...SHELL_KEYS].sort());
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual([...OFFICIAL_KEYS].sort());
  });

  it("is a no-op when the shell never wrote anything", async () => {
    await AsyncStorage.setItem("@paseo:app-settings", "{}");
    expect(await clearPaseoGoLocalData()).toEqual([]);
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(["@paseo:app-settings"]);
  });
});
describe("resetShellStores", () => {
  it("returns every shell store to defaults and pins the seam off", () => {
    const favorite = {
      hostId: "srv-A",
      workspaceId: "ws-1",
      workspaceRoot: "C:/tmp/c5-proj",
      path: "photo.png",
      name: "photo.png",
      size: 1,
      mtime: "2026-09-25T06:00:00Z",
    };
    usePaseoGoFavoritesStore.getState().addFavorite(favorite, 1);
    usePaseoGoCommandsStore
      .getState()
      .addCommand({ name: "速览", hostId: "srv-A", prompt: "ls" }, 2);
    usePaseoGoPinsStore.getState().togglePin("srv-A:agent-1");
    usePaseoGoPinsStore.getState().setAlias("srv-A:agent-1", "旧对话");
    usePaseoGoArchiveStore.getState().archive("srv-A:agent-2");
    usePaseoGoReadStateStore.getState().markRead("srv-A:agent-1", 123);
    usePaseoGoSettingsStore.getState().setShellMode(true);
    usePaseoGoSettingsStore.getState().setDefaultTab("workspace");

    resetShellStores();

    const state = usePaseoGoSettingsStore.getState();
    expect(usePaseoGoFavoritesStore.getState().items).toEqual([]);
    expect(usePaseoGoCommandsStore.getState().items).toEqual([]);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual([]);
    expect(usePaseoGoPinsStore.getState().aliases).toEqual({});
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual([]);
    expect(usePaseoGoReadStateStore.getState().lastReadAt).toEqual({});
    expect(state.defaultTab).toBe("chats");
    // false, not null: null defers to the env default, which is ON under dev metro.
    expect(state.shellMode).toBe(false);
  });

  it("a cold rehydrate after clear+reset restores empty lists", async () => {
    usePaseoGoFavoritesStore.getState().addFavorite({
      hostId: "srv-A",
      workspaceId: "ws-1",
      workspaceRoot: "C:/tmp/c5-proj",
      path: "a.md",
      name: "a.md",
      size: 1,
      mtime: "x",
    });
    await clearPaseoGoLocalData();
    resetShellStores();
    // The reset re-persists the default envelopes; hydrating from disk must then
    // observe the cleared state, not the pre-clear favorites.
    await usePaseoGoFavoritesStore.persist.rehydrate();
    expect(usePaseoGoFavoritesStore.getState().items).toEqual([]);
  });
});
