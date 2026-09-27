// R2-14 regression (the R2-13 eviction chain): a non-compliant host date made
// chatLastEventAtFromAgent return NaN; markRead wrote it into lastReadAt, the
// persisted schema (z.number().int().nonnegative()) rejected the envelope on
// setItem, and validated-persist-storage then dropped the WHOLE readState store
// — every chat's read watermark lost at once. markRead must refuse non-stamp
// watermarks at the entry so the bad value never reaches the persist layer.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same synchronous Map backing as clear-local-data.test.ts: the validated
// storage's schema check + Map write run synchronously inside setState (the
// mock's promise only satisfies the API shape), so the envelope is observable
// the instant markRead returns — no timers, no ticks.
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
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";

const PERSIST_KEY = "paseoGo.readState";

beforeEach(() => {
  usePaseoGoReadStateStore.getState().clearAll();
});

describe("markRead watermark guard (R2-14)", () => {
  it("drops NaN instead of poisoning the persisted store", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      usePaseoGoReadStateStore.getState().markRead("srv:a", 1_000);
      usePaseoGoReadStateStore.getState().markRead("srv:b", Number.NaN);

      expect(usePaseoGoReadStateStore.getState().lastReadAt).not.toHaveProperty("srv:b");
      // The eviction chain, observed end-to-end: the envelope must STILL carry
      // the good stamp — pre-fix, the NaN write failed schema validation and
      // the validated storage removed the whole key.
      const raw = await AsyncStorage.getItem(PERSIST_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).state.lastReadAt).toEqual({ "srv:a": 1_000 });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("drops negative / non-integer / Infinity watermarks — the schema's own domain", () => {
    const state = usePaseoGoReadStateStore.getState();
    state.markRead("srv:neg", -1);
    state.markRead("srv:frac", 1.5);
    state.markRead("srv:inf", Number.POSITIVE_INFINITY);
    expect(usePaseoGoReadStateStore.getState().lastReadAt).toEqual({});
  });

  it("keeps the compliant path: a real host-domain stamp lands in the store", () => {
    usePaseoGoReadStateStore.getState().markRead("srv:a", 1_700_000_000_000);
    expect(usePaseoGoReadStateStore.getState().lastReadAt).toEqual({
      "srv:a": 1_700_000_000_000,
    });
  });
});
