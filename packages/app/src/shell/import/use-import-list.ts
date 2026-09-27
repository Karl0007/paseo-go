// Import-list loading for the shell import screen (card C10; F1 review fix). The
// screen owns selection/progress; this hook owns the fetch lifecycle: the request
// sequence guard (a superseded response never commits) AND the stale-request
// guard — a `load` closure is only allowed to run while its FULL request identity
// (serverId + client + query + limit) is still the current one. Without the
// latter, the tail of a mid-import host switch calls A's closure, or — R2-05 —
// the tail of a mid-import query edit calls the press-time closure on the SAME
// host: its `++requestSeq` grabs the newest slot and the stale response
// overwrites the list the search box just produced (host-only guard passed it).
// C23: `query` joins the fetch input and the `load` identity, so a query edit
// also advances the seq — a response for an old query can never overwrite a
// newer one. React-free of the screen's chrome so the race is unit-testable
// with renderHook.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";

/** The one RPC the loader needs; `DaemonClient` satisfies it structurally. */
export interface ImportListClient {
  fetchRecentProviderSessions(input: { limit: number; query?: string }): Promise<{
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
  query: string,
): { listState: ImportListState; load: () => Promise<void> } {
  const [listState, setListState] = useState<ImportListState>(INITIAL_STATE);
  const requestSeq = useRef(0);
  // Latest request identity, kept fresh on every render so closures created
  // earlier (the import tail, a memoized retry button) can detect they went
  // stale — on ANY axis, not just the host (R2-05).
  const currentRequest = useRef({ serverId, client, query, limit });
  currentRequest.current = { serverId, client, query, limit };

  const load = useCallback(async () => {
    if (!client) return;
    const fresh = currentRequest.current;
    if (
      serverId !== fresh.serverId ||
      client !== fresh.client ||
      query !== fresh.query ||
      limit !== fresh.limit
    ) {
      return;
    }
    const seq = ++requestSeq.current;
    setListState((prev) => ({ ...prev, status: "loading" }));
    try {
      const payload = await client.fetchRecentProviderSessions(
        query ? { limit, query } : { limit },
      );
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
  }, [client, limit, query, serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { listState, load };
}
