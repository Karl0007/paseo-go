// C3 acceptance: the pins/archive store contracts the chat interactions lean on —
// duplicate pins never double-list, drag drops persist their order, archive moves
// rows in and out exactly once, and everything survives a restart (rehydrate from
// the in-test storage after a cold in-memory reset).
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
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";

const PINS_KEY = "paseoGo.pins";
const ARCHIVE_KEY = "paseoGo.archive";

async function persisted(name: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(name);
  return raw === null ? null : JSON.parse(raw);
}

// zustand persist writes synchronously through the mock, so wiping memory must be
// followed by re-seeding the disk with the snapshot taken before the wipe —
// otherwise the wipe's own write is what the restart reads back.
async function simulateRestart(
  name: string,
  snapshot: unknown,
  rehydrate: () => Promise<unknown> | unknown,
): Promise<void> {
  await AsyncStorage.setItem(name, JSON.stringify(snapshot));
  await rehydrate();
}

beforeEach(async () => {
  await usePaseoGoPinsStore.persist.clearStorage();
  await usePaseoGoArchiveStore.persist.clearStorage();
  usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
  usePaseoGoArchiveStore.setState({ archivedIds: [] });
});

describe("pins store", () => {
  it("pins a row once: duplicate 置顶 never lists it twice", () => {
    const pins = usePaseoGoPinsStore.getState();
    pins.togglePin("s1:a1", true);
    pins.togglePin("s1:a1", true);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1"]);
  });

  it("bare toggle flips pin state both ways", () => {
    usePaseoGoPinsStore.getState().togglePin("s1:a1");
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1"]);
    usePaseoGoPinsStore.getState().togglePin("s1:a1");
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual([]);
  });

  it("re-pinned rows append to the order tail", () => {
    const pins = usePaseoGoPinsStore.getState();
    pins.togglePin("s1:a1", true);
    pins.togglePin("s1:a2", true);
    pins.togglePin("s1:a1", false);
    pins.togglePin("s1:a1", true);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a2", "s1:a1"]);
  });

  it("setOrder (drag drop) persists and survives a simulated restart", async () => {
    usePaseoGoPinsStore.getState().setOrder(["s1:a2", "s1:a1", "s1:a3"]);
    await vi.waitFor(async () => {
      const saved = (await persisted(PINS_KEY)) as { state: { pinnedIds: string[] } } | null;
      expect(saved?.state.pinnedIds).toEqual(["s1:a2", "s1:a1", "s1:a3"]);
    });
    const snapshot = await persisted(PINS_KEY);
    usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
    await simulateRestart(PINS_KEY, snapshot, () => usePaseoGoPinsStore.persist.rehydrate());
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a2", "s1:a1", "s1:a3"]);
  });

  it("setOrder copies its input; later caller mutations cannot edit persisted order", () => {
    const order = ["s1:a1", "s1:a2"];
    usePaseoGoPinsStore.getState().setOrder(order);
    order.push("s1:a3");
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1", "s1:a2"]);
  });

  it("aliases round-trip through storage; null clears the slot", async () => {
    const pins = usePaseoGoPinsStore.getState();
    pins.setAlias("s1:a1", "重构对话");
    pins.setAlias("s1:a2", "第二会话");
    await vi.waitFor(async () => {
      const saved = (await persisted(PINS_KEY)) as {
        state: { aliases: Record<string, string> };
      } | null;
      expect(saved?.state.aliases).toEqual({ "s1:a1": "重构对话", "s1:a2": "第二会话" });
    });

    usePaseoGoPinsStore.getState().setAlias("s1:a1", null);
    expect(usePaseoGoPinsStore.getState().aliases).toEqual({ "s1:a2": "第二会话" });

    const snapshot = await persisted(PINS_KEY);
    usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
    await simulateRestart(PINS_KEY, snapshot, () => usePaseoGoPinsStore.persist.rehydrate());
    expect(usePaseoGoPinsStore.getState().aliases).toEqual({ "s1:a2": "第二会话" });
  });
});

describe("archive store", () => {
  it("archiving twice moves the row in once", () => {
    const archive = usePaseoGoArchiveStore.getState();
    archive.archive("s1:a1");
    archive.archive("s1:a1");
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual(["s1:a1"]);
  });

  it("unarchive moves the row out and persists the migration", async () => {
    usePaseoGoArchiveStore.getState().archive("s1:a1");
    usePaseoGoArchiveStore.getState().archive("s1:a2");
    usePaseoGoArchiveStore.getState().unarchive("s1:a1");
    await vi.waitFor(async () => {
      const saved = (await persisted(ARCHIVE_KEY)) as {
        state: { archivedIds: string[] };
      } | null;
      expect(saved?.state.archivedIds).toEqual(["s1:a2"]);
    });
    const snapshot = await persisted(ARCHIVE_KEY);
    usePaseoGoArchiveStore.setState({ archivedIds: [] });
    await simulateRestart(ARCHIVE_KEY, snapshot, () => usePaseoGoArchiveStore.persist.rehydrate());
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual(["s1:a2"]);
  });

  it("unarchiving a live row is a no-op", () => {
    usePaseoGoArchiveStore.getState().unarchive("s1:ghost");
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual([]);
  });
});
