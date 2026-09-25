// C6 acceptance: the favorites store contracts — hostId+path dedup (re-add refreshes
// the snapshot and re-orders, never double-lists), removal hits exactly one entry,
// and the list survives a restart (persisted snapshot rehydrates into a cold store).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isFavoritePath, usePaseoGoFavoritesStore } from "@/shell/stores/favorites";

const FAVORITES_KEY = "paseoGo.favorites";

const fixture = {
  hostId: "srv-A",
  workspaceId: "ws-1",
  workspaceRoot: "C:/tmp/c5-proj",
  path: "photo.png",
  name: "photo.png",
  size: 100,
  mtime: "2026-09-25T06:00:00Z",
};

// zustand persist stores an { state, version } envelope through the validated storage.
async function persisted(): Promise<{ state: { items: unknown[] } } | null> {
  const raw = await AsyncStorage.getItem(FAVORITES_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  await usePaseoGoFavoritesStore.persist.clearStorage();
  usePaseoGoFavoritesStore.setState({ items: [] });
});

describe("addFavorite dedup", () => {
  it("lists a file once per host+path, newest first", () => {
    const store = usePaseoGoFavoritesStore.getState();
    store.addFavorite(fixture, 1);
    store.addFavorite({ ...fixture, path: "notes.md", name: "notes.md" }, 2);
    store.addFavorite({ ...fixture, path: "中文文档.md", name: "中文文档.md" }, 3);
    store.addFavorite({ ...fixture, size: 128 }, 4);
    const items = usePaseoGoFavoritesStore.getState().items;
    expect(items.map((item) => item.path)).toEqual(["photo.png", "中文文档.md", "notes.md"]);
    expect(items[0]?.size).toBe(128);
  });

  it("keys identity on the host, so the same path on two hosts is two favorites", () => {
    const store = usePaseoGoFavoritesStore.getState();
    store.addFavorite(fixture, 1);
    store.addFavorite({ ...fixture, hostId: "srv-B", workspaceId: "ws-2" }, 2);
    expect(usePaseoGoFavoritesStore.getState().items).toHaveLength(2);
  });
});

describe("removeFavorite", () => {
  it("removes exactly the host+path entry and reports favorites consistently", () => {
    const store = usePaseoGoFavoritesStore.getState();
    store.addFavorite(fixture, 1);
    store.addFavorite({ ...fixture, path: "notes.md", name: "notes.md" }, 2);
    usePaseoGoFavoritesStore.getState().removeFavorite("srv-A", "photo.png");
    const items = usePaseoGoFavoritesStore.getState().items;
    expect(items.map((item) => item.path)).toEqual(["notes.md"]);
    expect(isFavoritePath(items, "srv-A", "photo.png")).toBe(false);
    expect(isFavoritePath(items, "srv-A", "notes.md")).toBe(true);
    expect(isFavoritePath(items, "srv-B", "notes.md")).toBe(false);
  });
});

describe("persistence", () => {
  it("writes the validated snapshot and restores it across a simulated restart", async () => {
    usePaseoGoFavoritesStore.getState().addFavorite(fixture, 1);
    usePaseoGoFavoritesStore
      .getState()
      .addFavorite({ ...fixture, path: "installer.apk", name: "installer.apk", size: 8388608 }, 2);
    const snapshot = await persisted();
    expect(snapshot?.state.items).toHaveLength(2);

    // Cold store (as after app kill) + the disk snapshot → rehydrate restores both
    // entries with their metadata intact.
    usePaseoGoFavoritesStore.setState({ items: [] });
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(snapshot));
    await usePaseoGoFavoritesStore.persist.rehydrate();
    const items = usePaseoGoFavoritesStore.getState().items;
    expect(items.map((item) => item.path)).toEqual(["installer.apk", "photo.png"]);
    expect(items[0]?.size).toBe(8388608);
    expect(items[1]?.mtime).toBe("2026-09-25T06:00:00Z");
  });

  it("drops a corrupt payload instead of crashing the tab", async () => {
    await AsyncStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify({ state: { items: [{ nope: true }] }, version: 0 }),
    );
    await usePaseoGoFavoritesStore.persist.rehydrate();
    expect(usePaseoGoFavoritesStore.getState().items).toEqual([]);
  });
});
