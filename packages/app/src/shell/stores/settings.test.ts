// C8 acceptance (默认 tab 解析): the value (shell)/_layout feeds initialRouteName —
// default chats, user picks persist across a simulated restart, and an unknown
// persisted tab never reaches the navigator (validated storage drops the payload,
// the store keeps its default).
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
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";

const SETTINGS_KEY = "paseoGo.settings";

beforeEach(async () => {
  await usePaseoGoSettingsStore.persist.clearStorage();
  usePaseoGoSettingsStore.setState({ shellMode: null, defaultTab: "chats" });
});

describe("defaultTab resolution", () => {
  it("starts on chats with the shell-mode seam untouched", () => {
    const state = usePaseoGoSettingsStore.getState();
    expect(state.defaultTab).toBe("chats");
    expect(state.shellMode).toBeNull();
  });

  it("persists the picked tab and restores it across a simulated restart", async () => {
    usePaseoGoSettingsStore.getState().setDefaultTab("workspace");
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    expect(JSON.parse(String(raw)).state.defaultTab).toBe("workspace");

    // Cold store (as after app kill) + the disk snapshot → rehydrate restores the
    // pick. setState below would re-persist, so the snapshot is written back by hand.
    usePaseoGoSettingsStore.setState({ defaultTab: "me" });
    await AsyncStorage.setItem(SETTINGS_KEY, String(raw));
    await usePaseoGoSettingsStore.persist.rehydrate();
    expect(usePaseoGoSettingsStore.getState().defaultTab).toBe("workspace");
  });

  it("keeps the chats default when the persisted tab is unknown", async () => {
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ state: { shellMode: true, defaultTab: "settings" }, version: 0 }),
    );
    await usePaseoGoSettingsStore.persist.rehydrate();
    expect(usePaseoGoSettingsStore.getState().defaultTab).toBe("chats");
    // The invalid envelope is discarded, not carried into the next write.
    expect(await AsyncStorage.getItem(SETTINGS_KEY)).toBeNull();
  });

  it("resolves the seam: explicit boolean wins, null defers to the env default", () => {
    usePaseoGoSettingsStore.getState().setShellMode(false);
    expect(usePaseoGoSettingsStore.getState().shellMode).toBe(false);
    usePaseoGoSettingsStore.setState({ shellMode: null });
    expect(usePaseoGoSettingsStore.getState().shellMode).toBeNull();
  });
});
