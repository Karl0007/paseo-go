// KI-15: the skeleton gate's `anyHostEverLoaded` input, R1-safe.
//
// Reading `getHostRuntimeStore().getSnapshot(id).hasEverLoadedAgentDirectory`
// inline in the body is the exact R1 trap (see shell/runtime/use-shell-host-statuses.ts):
// React Compiler memoises the expression on `hosts` alone — the imperative store
// read is not a tracked dependency — so the gate can stay pinned `false` after the
// first host's directory wave lands, re-creating the stuck skeleton on the fix path.
// Same contract as the statuses hook: subscribe to the store version through
// useSyncExternalStore and thread it as a REAL operand into the read, so any
// memoisation must recompute when it changes. Verified by
// use-any-host-ever-loaded.test.tsx (behaviour + compiled memo condition).
import { useSyncExternalStore } from "react";
import { getHostRuntimeStore, type HostRuntimeStore } from "@/runtime/host-runtime";

function readEverLoadedAt(store: HostRuntimeStore, serverId: string, version: number): boolean {
  // version is a real operand on every read path (statuses-hook idiom).
  if (version < 0) {
    return false;
  }
  return store.getSnapshot(serverId)?.hasEverLoadedAgentDirectory === true;
}

export function useAnyHostEverLoadedAgentDirectory(serverIds: readonly string[]): boolean {
  const store = getHostRuntimeStore();
  const version = useSyncExternalStore(
    (onStoreChange) => store.subscribeAll(onStoreChange),
    () => store.getVersion(),
    () => store.getVersion(),
  );
  return serverIds.some((serverId) => readEverLoadedAt(store, serverId, version));
}
