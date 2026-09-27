// 清除本地数据 (DESIGN §6, card C8): deletes every AsyncStorage entry the shell
// owns — the `paseoGo.*` zustand persist envelopes — and nothing else. Official
// state (`@paseo:*` keys, hosts, sessions, app settings) is upstream territory and
// survives; the unit test pins that scope. Storage is injectable so the test runs
// against a Map-backed fake.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoCommandsStore } from "@/shell/stores/commands";
import { usePaseoGoFavoritesStore } from "@/shell/stores/favorites";
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";

export const PASEO_GO_STORAGE_PREFIX = "paseoGo.";

export interface PaseoGoClearableStorage {
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: string[]): Promise<void>;
}

/** Removes every `paseoGo.*` key; returns the keys it deleted (the audit trail). */
export async function clearPaseoGoLocalData(
  storage: PaseoGoClearableStorage = AsyncStorage,
): Promise<string[]> {
  const keys = await storage.getAllKeys();
  const doomed = keys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(PASEO_GO_STORAGE_PREFIX),
  );
  if (doomed.length > 0) await storage.multiRemove(doomed);
  return doomed;
}

/**
 * Drops the in-memory halves of the same data. The screens unmount on the way to
 * the official IA, but the zustand singletons outlive navigation — without this,
 * re-entering the shell in the same JS session would resurrect the cleared lists.
 *
 * `shellMode: false` rather than the null default: null defers to the bundle-time
 * env default, which is ON for dev metro — the app would bounce straight back into
 * the shell, breaking the card's「删后回官方 IA」contract. With the env default off
 * (release semantics) false and null observe identically.
 */
export function resetShellStores(): void {
  usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
  usePaseoGoArchiveStore.setState({ archivedIds: [] });
  usePaseoGoReadStateStore.setState({ lastReadAt: {} });
  usePaseoGoFavoritesStore.setState({ items: [] });
  usePaseoGoCommandsStore.setState({ items: [] });
  usePaseoGoForkAckStore.setState({ ackedKeys: [] });
  usePaseoGoSettingsStore.setState({
    shellMode: false,
    defaultTab: "chats",
    notifications: true,
  });
}
