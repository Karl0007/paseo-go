// 文件屏 git 记录段数据层 (card KI-7, 用户二轮拍板 2026-09-29 = Git Graph DAG):
// full HEAD history over the pure-add `checkout.history.list` RPC, paged by
// commit count, with the server-computed lane geometry the SVG column draws.
// The sync header reuses the EXISTING checkout_status query (zero new RPCs).
// Capability gate = the KI-6S contract: an
// rpc_error{requestType:"checkout.history.list.request"} means "host has no
// full-history RPC" — the pane then falls back to the ahead-of-base
// CommitsSection (old daemon path stays intact).
// Race discipline (workspace-search idiom): every fetch takes a fresh seq; a
// superseded response never commits.
import { useCallback, useEffect, useRef, useState } from "react";

/** Structural slice of the protocol ref badge. */
export interface HistoryRef {
  name: string;
  kind: "head" | "local" | "remote" | "tag";
}

/** Structural slice of the protocol DAG edge (curve between two lanes). */
export interface HistoryEdge {
  fromLane: number;
  toLane: number;
  kind: "fork" | "merge";
}

/** Structural slice of one history entry (row). */
export interface HistoryEntry {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  dateISO: string;
  refs: readonly HistoryRef[];
  lane: number;
  topology: "dot" | "merge" | "edge";
  edges: readonly HistoryEdge[];
  laneEnds: boolean;
}

/** The RPC the hook needs; `DaemonClient.listCheckoutHistory` satisfies it. */
export interface HistoryClient {
  listCheckoutHistory(options: { cwd: string; limit?: number; skip?: number }): Promise<{
    isGit: boolean;
    entries: readonly HistoryEntry[];
    hasMore: boolean;
    currentBranch: string | null;
    upstreamRef: string | null;
    aheadOfOrigin: number | null;
    behindOfOrigin: number | null;
    hasRemote: boolean;
  }>;
}

export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_REQUEST_TYPE = "checkout.history.list.request";

/**
 * KI-6S capability-gate shape: the daemon's rpc_error for THIS request type —
 * and nothing else (timeouts/connection errors are transient, not a capability
 * verdict) — means the host predates full-history listing. Detection rides the
 * client's DaemonRpcError identity (name + requestType), same as workspace-search.
 */
export function isHistoryUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name.toLowerCase() !== "daemonrpcerror") return false;
  return (error as Error & { requestType?: unknown }).requestType === HISTORY_REQUEST_TYPE;
}

/** checkout_status slice the sync header reads (structural, push-driven cache). */
export interface SyncStatusInput {
  currentBranch: string | null;
  upstreamRef?: string | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
}

export interface SyncHeader {
  branch: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

/**
 * 头行 data (卡口径 `main ⇅ origin/main ↑2 ↓1`): branch = currentBranch, detached
 * HEAD falls back to the literal "HEAD". The full upstream ref is shortened for
 * display (refs/remotes/origin/main → origin/main).
 */
export function buildSyncHeader(status: SyncStatusInput | null | undefined): SyncHeader | null {
  if (!status) return null;
  const upstream = status.upstreamRef
    ? status.upstreamRef.replace(/^refs\/(?:remotes|heads)\//, "")
    : null;
  return {
    branch: status.currentBranch ?? "HEAD",
    upstream,
    ahead: status.aheadOfOrigin,
    behind: status.behindOfOrigin,
  };
}

/**
 * Header text: `main ⇅ origin/main ↑2 ↓1`. Arrows only carry a number when
 * non-zero (a synced branch reads `main ⇅ origin/main`); with no upstream the
 * line is just the branch name.
 */
export function formatSyncHeader(header: SyncHeader): string {
  if (!header.upstream) return header.branch;
  const parts = [`${header.branch} ⇅ ${header.upstream}`];
  if (header.ahead) parts.push(`↑${String(header.ahead)}`);
  if (header.behind) parts.push(`↓${String(header.behind)}`);
  return parts.join(" ");
}

/** Badge text for one ref: head renders Git-Graph style `HEAD → main`. */
export function refBadgeLabel(ref: HistoryRef): string {
  if (ref.kind !== "head") return ref.name;
  return ref.name === "HEAD" ? "HEAD" : `HEAD → ${ref.name}`;
}

export interface RowLanes {
  /** Lane columns with a line entering the row from above. */
  above: number[];
  /** Lane columns with a line leaving the row below. */
  below: number[];
}

/**
 * Derive the vertical line segments per row from the server geometry — pure
 * bookkeeping (which lanes are alive between rows), not layout math. A lane is
 * alive below a row when it continues from above (minus converging `merge`
 * edges), when the row's dot sits on it and the lane does not end there, or
 * when a `fork` edge opens/targets it.
 */
export function computeRowLanes(entries: readonly HistoryEntry[]): RowLanes[] {
  const rows: RowLanes[] = [];
  let active = new Set<number>();
  for (const entry of entries) {
    const above = [...active].sort((a, b) => a - b);
    for (const edge of entry.edges) {
      if (edge.kind === "merge") active.delete(edge.fromLane);
    }
    if (entry.laneEnds) active.delete(entry.lane);
    else active.add(entry.lane);
    for (const edge of entry.edges) {
      if (edge.kind === "fork") active.add(edge.toLane);
    }
    rows.push({ above, below: [...active].sort((a, b) => a - b) });
  }
  return rows;
}

/** Highest lane index in the page — the SVG column clamps beyond it. */
export function maxLaneOf(entries: readonly HistoryEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    if (entry.lane > max) max = entry.lane;
    for (const edge of entry.edges) {
      if (edge.toLane > max) max = edge.toLane;
    }
  }
  return max;
}

export interface CommitHistoryState {
  entries: HistoryEntry[];
  hasMore: boolean;
  /** First page in flight (or no client/cwd yet — pending, never a false empty). */
  loading: boolean;
  loadingMore: boolean;
  /** First page failed transiently; the pane offers Retry. */
  failed: boolean;
  /** Capability gate tripped: render the ahead-of-base CommitsSection instead. */
  unsupported: boolean;
}

const INITIAL_STATE: CommitHistoryState = {
  entries: [],
  hasMore: false,
  loading: true,
  loadingMore: false,
  failed: false,
  unsupported: false,
};

export interface CommitHistory extends CommitHistoryState {
  /** Fetch the next page (no-op while busy, exhausted, or unsupported). */
  loadMore: () => void;
  /** Refetch the first page (failure retry). */
  retry: () => void;
}

/**
 * Paged full-history state for one cwd. Remembers capability denials per
 * serverId for the screen's lifetime (a denial is a fact about the host, not
 * about the directory).
 */
export function useCommitHistory(input: {
  serverId: string;
  client: HistoryClient | null;
  cwd: string;
}): CommitHistory {
  const { serverId, client, cwd } = input;
  const [state, setState] = useState<CommitHistoryState>(INITIAL_STATE);
  const requestSeq = useRef(0);
  const unsupportedHostRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(
    (skip: number): void => {
      if (!client || cwd.length === 0) return;
      const seq = ++requestSeq.current;
      setState((prev) => ({
        ...prev,
        loading: skip === 0,
        loadingMore: skip > 0,
        failed: false,
      }));
      void (async () => {
        let payload;
        try {
          payload = await client.listCheckoutHistory({ cwd, limit: HISTORY_PAGE_SIZE, skip });
        } catch (error) {
          if (isHistoryUnsupportedError(error)) {
            unsupportedHostRef.current = serverId;
            setState((prev) => ({
              ...prev,
              unsupported: true,
              loading: false,
              loadingMore: false,
            }));
            return;
          }
          if (seq !== requestSeq.current) return;
          setState((prev) => ({
            ...prev,
            loading: false,
            loadingMore: false,
            failed: skip === 0 ? true : prev.failed,
          }));
          return;
        }
        if (seq !== requestSeq.current) return;
        setState((prev) => ({
          ...prev,
          entries: skip === 0 ? [...payload.entries] : [...prev.entries, ...payload.entries],
          hasMore: payload.hasMore,
          loading: false,
          loadingMore: false,
        }));
      })();
    },
    [client, cwd, serverId],
  );

  useEffect(() => {
    if (unsupportedHostRef.current === serverId) {
      setState((prev) => ({ ...prev, unsupported: true, loading: false }));
      return;
    }
    setState({ ...INITIAL_STATE, loading: client !== null && cwd.length > 0 });
    load(0);
  }, [client, cwd, load, serverId]);

  const loadMore = useCallback((): void => {
    const current = stateRef.current;
    if (current.loading || current.loadingMore || !current.hasMore || current.unsupported) return;
    load(current.entries.length);
  }, [load]);

  const retry = useCallback((): void => {
    load(0);
  }, [load]);

  return { ...state, loadMore, retry };
}
