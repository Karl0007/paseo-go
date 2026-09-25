// Import-list loading for the shell import screen (card C10; F1 review fix). The
// screen owns selection/progress; this hook owns the fetch lifecycle: the request
// sequence guard (a superseded response never commits) AND the stale-host guard —
// a `load` closure bound to host A must not run after the screen moved to host B.
// Without the latter, the tail of a mid-import host switch calls A's closure, its
// `++requestSeq` grabs the newest slot, and A's response overwrites B's list.
// React-free of the screen's chrome so the race is unit-testable with renderHook.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";

/** The one RPC the loader needs; `DaemonClient` satisfies it structurally. */
export interface ImportListClient {
  fetchRecentProviderSessions(input: { limit: number }): Promise<{
    entries: FetchRecentProviderSessionEntry[];
    filteredAlreadyImportedCount?: number;
    providerErrors?: Array<{ provider: string; message: string }>;
  }>;
}

export interface ImportListState {
  status: "loading" | "ready" | "error";
  entries: FetchRecentProviderSessionEntry[];
  alreadyImportedCount: number;
  providerErrors: Array<{ provider: string; message: string }>;
  error: string | null;
}

const INITIAL_STATE: ImportListState = {
  status: "loading",
  entries: [],
  alreadyImportedCount: 0,
  providerErrors: [],
  error: null,
};

export function useImportList(
  limit: number,
  serverId: string | null,
  client: ImportListClient | null,
): { listState: ImportListState; load: () => Promise<void> } {
  const [listState, setListState] = useState<ImportListState>(INITIAL_STATE);
  const requestSeq = useRef(0);
  // Latest host, kept fresh on every render so closures created earlier (the
  // import tail, a memoized retry button) can detect they went stale.
  const currentServerId = useRef(serverId);
  currentServerId.current = serverId;

  const load = useCallback(async () => {
    if (!client) return;
    if (serverId !== currentServerId.current) return;
    const seq = ++requestSeq.current;
    setListState((prev) => ({ ...prev, status: "loading" }));
    try {
      const payload = await client.fetchRecentProviderSessions({ limit });
      if (seq !== requestSeq.current) return;
      setListState({
        status: "ready",
        entries: payload.entries,
        alreadyImportedCount: payload.filteredAlreadyImportedCount ?? 0,
        providerErrors: payload.providerErrors ?? [],
        error: null,
      });
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setListState({
        status: "error",
        entries: [],
        alreadyImportedCount: 0,
        providerErrors: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [client, limit, serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { listState, load };
}
