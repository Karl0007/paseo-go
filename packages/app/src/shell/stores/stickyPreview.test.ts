// B5-SUB (F13) regression — 字段缺失时不清空已显示小字, the store half. The daemon's
// directory serves `lastMessagePreview: null` for pre-B4 records even for chats
// WITH messages (evidence/B5-SUB/ws-frames-before.txt), and the client merge is a
// whole-object replace, so the screen folds every observation into this store and
// the row falls back to it on a blank directory value. Two invariants:
//   1. blank (null/undefined/whitespace) NEVER clears or overwrites a remembered
//      preview — that is the wipe this card exists to kill;
//   2. the memory persists (the wipe paths include app restarts), and a deleted
//      chat's entry is forget-able like readState's.
// Same synchronous Map-backed AsyncStorage as readState.test.ts: the validated
// storage write lands inside setState, so the envelope is observable at once.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { usePaseoGoStickyPreviewStore } from "@/shell/stores/stickyPreview";

const PERSIST_KEY = "paseoGo.stickyPreview";

beforeEach(() => {
  usePaseoGoStickyPreviewStore.getState().clearAll();
});

describe("remember (keep-old-value fold)", () => {
  it("a blank observation never clears the remembered preview", () => {
    const store = usePaseoGoStickyPreviewStore.getState();
    store.remember("srv:a", "上一条消息");
    // The exact devd sequence: live preview → daemon restart → record says null.
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", null);
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", undefined);
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", "   \n ");
    expect(usePaseoGoStickyPreviewStore.getState().previews).toEqual({
      "srv:a": "上一条消息",
    });
  });

  it("a newer real preview replaces the old one (resume re-derives; the fact must land)", () => {
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", "旧消息");
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", "新消息");
    expect(usePaseoGoStickyPreviewStore.getState().previews["srv:a"]).toBe("新消息");
  });

  it("same-value folds are identity-stable (the screen folds on every directory tick)", () => {
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", "same");
    const before = usePaseoGoStickyPreviewStore.getState().previews;
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", "same");
    expect(usePaseoGoStickyPreviewStore.getState().previews).toBe(before);
  });

  it("persists the memory and forget drops it (delete cleanup, C3 lifecycle)", async () => {
    usePaseoGoStickyPreviewStore.getState().remember("srv:a", "消息");
    const raw = await AsyncStorage.getItem(PERSIST_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).state.previews).toEqual({ "srv:a": "消息" });

    usePaseoGoStickyPreviewStore.getState().forget("srv:a");
    expect(usePaseoGoStickyPreviewStore.getState().previews).toEqual({});
    // forget on an unknown key is a no-op, not a churn.
    const before = usePaseoGoStickyPreviewStore.getState().previews;
    usePaseoGoStickyPreviewStore.getState().forget("srv:missing");
    expect(usePaseoGoStickyPreviewStore.getState().previews).toBe(before);
  });
});
