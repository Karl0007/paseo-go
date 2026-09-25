// Shell-side replacement for the upstream `useHostRuntimeConnectionStatuses`
// aggregate hook (card R1-runtime-staleness). Upstream signals reactivity with
// `void version;` inside a useMemo; React Compiler (experiments.reactCompiler
// is on in app.config.js) re-infers the lambda's dependencies, does not count
// `void version` as a read, and drops version from the recomputation set — the
// returned Map then only refreshes when the `serverIds` array identity changes,
// pinning hosts to a stale "connecting" while the store is online. Here version
// is passed as a real operand into the status read, so the compiler must keep
// it as a dependency (verified by use-shell-host-statuses.test.tsx).
import { useSyncExternalStore } from "react";
import {
  getHostRuntimeStore,
  type HostRuntimeConnectionStatus,
  type HostRuntimeStore,
} from "@/runtime/host-runtime";

function readStatusAt(
  store: HostRuntimeStore,
  serverId: string,
  version: number,
): HostRuntimeConnectionStatus {
  // version is a real operand on every read path: any memoisation of this
  // scope (manual or compiler-inferred) must recompute when it changes.
  if (version < 0) {
    return "connecting";
  }
  return store.getSnapshot(serverId)?.connectionStatus ?? "connecting";
}

export function useShellHostStatuses(
  serverIds: readonly string[],
): ReadonlyMap<string, HostRuntimeConnectionStatus> {
  const store = getHostRuntimeStore();
  const version = useSyncExternalStore(
    (onStoreChange) => store.subscribeAll(onStoreChange),
    () => store.getVersion(),
    () => store.getVersion(),
  );
  const entries = serverIds.map(
    (serverId) => [serverId, readStatusAt(store, serverId, version)] as const,
  );
  return new Map(entries);
}
