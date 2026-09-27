// C24 acceptance: the fork-warning acknowledgement store. Ack is a per-row-key
// set (the archive posture): idempotent, individually clearable (the delete sweep),
// and durable — the whole point is "warn once per chat", so an ack must survive a
// restart (rehydrate from the in-test storage after a cold in-memory reset).
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
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";

const FORK_ACK_KEY = "paseoGo.forkAck";

async function persisted(name: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(name);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  await usePaseoGoForkAckStore.persist.clearStorage();
  usePaseoGoForkAckStore.setState({ ackedKeys: [] });
});

describe("forkAck store", () => {
  it("acking twice records the row once", () => {
    const ack = usePaseoGoForkAckStore.getState().ack;
    ack("s1:a1");
    ack("s1:a1");
    expect(usePaseoGoForkAckStore.getState().ackedKeys).toEqual(["s1:a1"]);
  });

  it("clear removes only its own row (the delete sweep)", () => {
    usePaseoGoForkAckStore.getState().ack("s1:a1");
    usePaseoGoForkAckStore.getState().ack("s1:a2");
    usePaseoGoForkAckStore.getState().clear("s1:a1");
    expect(usePaseoGoForkAckStore.getState().ackedKeys).toEqual(["s1:a2"]);
    usePaseoGoForkAckStore.getState().clear("s1:ghost");
    expect(usePaseoGoForkAckStore.getState().ackedKeys).toEqual(["s1:a2"]);
  });

  it("an ack survives a restart", async () => {
    usePaseoGoForkAckStore.getState().ack("s1:a1");
    await vi.waitFor(async () => {
      const saved = (await persisted(FORK_ACK_KEY)) as { state: { ackedKeys: string[] } } | null;
      expect(saved?.state.ackedKeys).toEqual(["s1:a1"]);
    });
    const snapshot = await persisted(FORK_ACK_KEY);
    usePaseoGoForkAckStore.setState({ ackedKeys: [] });
    await AsyncStorage.setItem(FORK_ACK_KEY, JSON.stringify(snapshot));
    await usePaseoGoForkAckStore.persist.rehydrate();
    expect(usePaseoGoForkAckStore.getState().ackedKeys).toEqual(["s1:a1"]);
  });
});
