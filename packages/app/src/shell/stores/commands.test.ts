// C7 acceptance: the commands store contracts — add mints unique ids and stamps
// createdAt, update rewrites in place without touching the stamp, remove hits
// exactly one entry, and the list survives a restart (persisted snapshot rehydrates
// into a cold store; a corrupt payload drops instead of crashing).
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
import { usePaseoGoCommandsStore } from "@/shell/stores/commands";

const COMMANDS_KEY = "paseoGo.commands";

const base = {
  name: "列出目录结构",
  hostId: "srv-A",
  prompt: "列出当前目录结构",
};

// zustand persist stores an { state, version } envelope through the validated storage.
async function persisted(): Promise<{ state: { items: unknown[] } } | null> {
  const raw = await AsyncStorage.getItem(COMMANDS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  await usePaseoGoCommandsStore.persist.clearStorage();
  usePaseoGoCommandsStore.setState({ items: [] });
});

describe("addCommand", () => {
  it("mints a unique id per add and prepends newest first", () => {
    const store = usePaseoGoCommandsStore.getState();
    const first = store.addCommand(base, 10);
    const second = usePaseoGoCommandsStore.getState().addCommand({ ...base, name: "跑测试" }, 20);
    expect(second).not.toBe(first);
    const items = usePaseoGoCommandsStore.getState().items;
    expect(items.map((item) => item.id)).toEqual([second, first]);
    expect(items[0]?.createdAt).toBe(20);
  });

  it("stores optionals as absent, not null — the schema only knows undefined", () => {
    usePaseoGoCommandsStore
      .getState()
      .addCommand({ ...base, workspaceId: null, providerModel: null });
    const [item] = usePaseoGoCommandsStore.getState().items;
    expect(item).not.toHaveProperty("workspaceId");
    expect(item).not.toHaveProperty("providerModel");
  });
});

describe("updateCommand / removeCommand", () => {
  it("rewrites the entry in place, keeping id and createdAt", () => {
    const id = usePaseoGoCommandsStore.getState().addCommand({ ...base, workspaceId: "ws-1" }, 10);
    usePaseoGoCommandsStore.getState().addCommand({ ...base, name: "另一条" }, 20);
    usePaseoGoCommandsStore
      .getState()
      .updateCommand(id, { ...base, name: "改名", workspaceId: null, providerModel: "codex" });
    const items = usePaseoGoCommandsStore.getState().items;
    expect(items).toHaveLength(2);
    const updated = items.find((item) => item.id === id);
    expect(updated?.name).toBe("改名");
    expect(updated?.createdAt).toBe(10);
    expect(updated).not.toHaveProperty("workspaceId");
    expect(updated?.providerModel).toBe("codex");
  });

  it("removes exactly one entry by id", () => {
    const keep = usePaseoGoCommandsStore.getState().addCommand(base, 10);
    const drop = usePaseoGoCommandsStore.getState().addCommand({ ...base, name: "删我" }, 20);
    usePaseoGoCommandsStore.getState().removeCommand(drop);
    const items = usePaseoGoCommandsStore.getState().items;
    expect(items.map((item) => item.id)).toEqual([keep]);
  });
});

describe("persistence", () => {
  it("writes the validated snapshot and restores it across a simulated restart", async () => {
    usePaseoGoCommandsStore
      .getState()
      .addCommand({ ...base, workspaceId: "ws-1", providerModel: "codex/gpt-5" }, 10);
    const snapshot = await persisted();
    expect(snapshot?.state.items).toHaveLength(1);

    usePaseoGoCommandsStore.setState({ items: [] });
    await AsyncStorage.setItem(COMMANDS_KEY, JSON.stringify(snapshot));
    await usePaseoGoCommandsStore.persist.rehydrate();
    const [item] = usePaseoGoCommandsStore.getState().items;
    expect(item?.name).toBe("列出目录结构");
    expect(item?.workspaceId).toBe("ws-1");
    expect(item?.providerModel).toBe("codex/gpt-5");
    expect(item?.createdAt).toBe(10);
  });

  it("drops a corrupt payload instead of crashing the tab", async () => {
    await AsyncStorage.setItem(
      COMMANDS_KEY,
      JSON.stringify({ state: { items: [{ id: "x" }] }, version: 0 }),
    );
    await usePaseoGoCommandsStore.persist.rehydrate();
    expect(usePaseoGoCommandsStore.getState().items).toEqual([]);
  });
});
