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
import { pinnedDropIndex, usePaseoGoPinsStore } from "@/shell/stores/pins";

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

// KI-11 ruling ④: the drop-into-置顶 write unified onto `togglePin`'s optional
// placement — the SAME store action the menu button calls (the button just never
// passes an index). `pinnedDropIndex` remains the flat-list → group-slot
// conversion; the placement write is clamped and idempotent.
describe("pins store: KI-11 togglePin placement (drop into 置顶)", () => {
  it("pins an unpinned row at the drop slot", () => {
    usePaseoGoPinsStore.getState().setOrder(["s1:a1", "s1:a2", "s1:a3"]);
    usePaseoGoPinsStore.getState().togglePin("s1:x", true, 1);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1", "s1:x", "s1:a2", "s1:a3"]);
  });

  it("clamps out-of-range slots to the group edges", () => {
    usePaseoGoPinsStore.getState().setOrder(["s1:a1", "s1:a2"]);
    usePaseoGoPinsStore.getState().togglePin("s1:top", true, -5);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:top", "s1:a1", "s1:a2"]);
    usePaseoGoPinsStore.getState().togglePin("s1:tail", true, 99);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual([
      "s1:top",
      "s1:a1",
      "s1:a2",
      "s1:tail",
    ]);
  });

  it("an already-pinned placement moves within the group and never duplicates", () => {
    usePaseoGoPinsStore.getState().setOrder(["s1:a1", "s1:a2", "s1:a3"]);
    usePaseoGoPinsStore.getState().togglePin("s1:a1", true, 2);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a2", "s1:a3", "s1:a1"]);
  });

  it("the button shape (no index) keeps append-to-tail and stays a no-op when pinned", () => {
    usePaseoGoPinsStore.getState().setOrder(["s1:a1", "s1:a2"]);
    usePaseoGoPinsStore.getState().togglePin("s1:a1", true); // already pinned: inert
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1", "s1:a2"]);
    usePaseoGoPinsStore.getState().togglePin("s1:x", true);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1", "s1:a2", "s1:x"]);
  });

  it("placement persists and survives a simulated restart", async () => {
    usePaseoGoPinsStore.getState().setOrder(["s1:a1"]);
    usePaseoGoPinsStore.getState().togglePin("s1:x", true, 0);
    await vi.waitFor(async () => {
      const saved = (await persisted(PINS_KEY)) as { state: { pinnedIds: string[] } } | null;
      expect(saved?.state.pinnedIds).toEqual(["s1:x", "s1:a1"]);
    });
    const snapshot = await persisted(PINS_KEY);
    usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
    await simulateRestart(PINS_KEY, snapshot, () => usePaseoGoPinsStore.persist.rehydrate());
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:x", "s1:a1"]);
  });
});

describe("pinnedDropIndex: flat drop slot → group-relative index", () => {
  const PINNED = ["p1", "p2", "p3"];
  const at = (droppedKey: string, visibleRowKeys: string[]) =>
    pinnedDropIndex({ droppedKey, visibleRowKeys, pinnedIds: PINNED });

  it("a drop between two pinned rows lands in the matching group slot", () => {
    expect(at("u1", ["p1", "u1", "p2", "p3"])).toBe(1);
  });

  it("other groups offset the position but never count", () => {
    // The drop sits deep in 需要处理/最近, right after two pinned rows.
    expect(at("u1", ["p1", "p2", "n1", "u1", "r1", "r2"])).toBe(2);
  });

  it("a drop below the whole group saturates to the group tail", () => {
    expect(at("u1", ["p1", "p2", "p3", "n1", "u1"])).toBe(3);
  });

  it("a drop above the first pinned row yields 0", () => {
    expect(at("u1", ["u1", "p1", "p2"])).toBe(0);
  });

  it("a dropped pinned row counts siblings only — never itself", () => {
    expect(at("p2", ["p1", "n1", "p2", "p3"])).toBe(1);
  });

  it("a droppedKey missing from the visible list clamps to the tail", () => {
    expect(at("ghost", ["p1", "p2", "p3", "n1"])).toBe(3);
  });

  it("stale hidden pins are not counted (index is visible-relative)", () => {
    expect(
      pinnedDropIndex({
        droppedKey: "u1",
        visibleRowKeys: ["p1", "u1", "p2"],
        pinnedIds: ["p1", "gone", "p2"],
      }),
    ).toBe(1);
  });
});
