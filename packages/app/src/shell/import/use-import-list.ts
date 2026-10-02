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
// newer one. KI-13: a host switch additionally RESETS the list state (entries/
// alreadyImportedCount/providerErrors) in the switch render itself — stale rows
// surviving into the new host's loading window was the bug, not the race.
// React-free of the screen's chrome so the race is unit-testable with renderHook.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";

/** The one RPC the loader needs; `DaemonClient` satisfies it structurally. */
export interface ImportListClient {
  fetchRecentProviderSessions(input: {
    limit: number;
    query?: string;
    includeExisting?: boolean;
  }): Promise<{
    entries: FetchRecentProviderSessionEntry[];
    filteredAlreadyImportedCount?: number;
    claimedTotal?: number;
    providerErrors?: Array<{ provider: string; message: string }>;
  }>;
}

export interface ImportListState {
  status: "loading" | "ready" | "error";
  entries: FetchRecentProviderSessionEntry[];
  alreadyImportedCount: number;
  /**
   * B8-COUNT (F24): 全量在册认领数（服务端 claim 索引口径，与返回窗无关）。
   * `null` = 这台 daemon 没报这个字段（旧 daemon）或还没拿到响应——导入屏的
   * 说明行按「有数才说」渲染，旧 daemon 上整行不出现。
   */
  claimedTotal: number | null;
  providerErrors: Array<{ provider: string; message: string }>;
  error: string | null;
}

const INITIAL_STATE: ImportListState = {
  status: "loading",
  entries: [],
  alreadyImportedCount: 0,
  claimedTotal: null,
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
  // KI-13: host-switch clears. The moment `serverId` changes the list enters the
  // fresh state — the old host's entries/count/errors must not survive even one
  // committed frame, or the status line (judged on the NEW host) and the rows
  // (still the OLD host's data) mislead the user into checking dead rows. This
  // is render-phase state adjustment (React's documented derive-on-prop-change
  // pattern): the reset is part of the switch render itself, so the commit after
  // a switch already shows the empty loading list. Advancing `requestSeq` here
  // also invalidates an old-host fetch that is ALREADY in flight — without it,
  // an A response landing in the window between this render and the reload
  // effect would repopulate the just-cleared list before the seq guard moves.
  const prevServerId = useRef(serverId);
  if (prevServerId.current !== serverId) {
    prevServerId.current = serverId;
    requestSeq.current += 1;
    setListState(INITIAL_STATE);
  }
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
      // B5-IMPORT2 (D20): includeExisting=true → 新 daemon 不再剔除已存在会话，
      // 逐条挂 existing（徽标真值）；旧 daemon zod 剥未知键=照旧剔除，壳侧
      // 目录索引继续兜底（rows.buildImportRowBadgeMap 回退源）。
      const payload = await client.fetchRecentProviderSessions(
        query ? { limit, query, includeExisting: true } : { limit, includeExisting: true },
      );
      if (seq !== requestSeq.current) return;
      setListState({
        status: "ready",
        entries: payload.entries,
        alreadyImportedCount: payload.filteredAlreadyImportedCount ?? 0,
        claimedTotal: payload.claimedTotal ?? null,
        providerErrors: payload.providerErrors ?? [],
        error: null,
      });
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setListState({
        status: "error",
        entries: [],
        alreadyImportedCount: 0,
        claimedTotal: null,
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
