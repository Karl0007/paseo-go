// M4 slice 2: the persisted「提示过了」flag — survives restarts (banner 一次性 is a
// cross-launch promise), and pre-M4 envelopes (no key) must stay valid instead of
// tripping the validated-storage discard path.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: async (key: string) => {
        storage.delete(key);
      },
      getAllKeys: async () => [...storage.keys()],
      multiRemove: async (keys: string[]) => {
        for (const key of keys) storage.delete(key);
      },
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePaseoGoUpdateNoticeStore } from "@/shell/stores/updateNotice";

const NOTICE_KEY = "paseoGo.updateNotice";

beforeEach(async () => {
  await usePaseoGoUpdateNoticeStore.persist.clearStorage();
  usePaseoGoUpdateNoticeStore.setState({ seenVersion: null });
});

describe("updateNotice store", () => {
  it("starts unseen and persists markSeen across a simulated restart", async () => {
    expect(usePaseoGoUpdateNoticeStore.getState().seenVersion).toBeNull();

    usePaseoGoUpdateNoticeStore.getState().markSeen("0.10.2-go.6");
    const raw = await AsyncStorage.getItem(NOTICE_KEY);
    expect(JSON.parse(String(raw)).state.seenVersion).toBe("0.10.2-go.6");

    // setState below would re-persist, so the disk snapshot is written back by hand.
    usePaseoGoUpdateNoticeStore.setState({ seenVersion: null });
    await AsyncStorage.setItem(NOTICE_KEY, String(raw));
    await usePaseoGoUpdateNoticeStore.persist.rehydrate();
    expect(usePaseoGoUpdateNoticeStore.getState().seenVersion).toBe("0.10.2-go.6");
  });

  it("keeps pre-M4 envelopes valid: a payload without the key rehydrates to unseen", async () => {
    await AsyncStorage.setItem(NOTICE_KEY, JSON.stringify({ state: {} }));
    await usePaseoGoUpdateNoticeStore.persist.rehydrate();
    expect(usePaseoGoUpdateNoticeStore.getState().seenVersion).toBeNull();
  });
});
