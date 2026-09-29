// 文件屏两层搜索 (card KI-6, 用户拍板 2026-09-29 = VSCode 体验):
//  · Tier 1 全仓文件名 — the EXISTING `directory_suggestions_request` RPC with
//    cwd=workspace root + includeFiles + matchMode "fuzzy" (server session.ts is
//    gitignore-aware and returns entries relative to cwd, so a hit's path drops
//    straight into shellPreviewHref's workspace-relative `path` contract).
//  · Tier 2 内容兜底 — `workspace.content_search.request` (KI-6S). Auto-fires
//    only when the name layer answered ZERO hits. There is no server_info
//    feature flag: the capability gate is the KI-6S contract — an
//    rpc_error{requestType:"workspace.content_search.request"} means "host has
//    no content search": degrade to Tier-1-only silently and stop asking for
//    this host (no toast, no repeat requests).
//  · 兜底兜底 — a Tier-1 RPC failure/timeout (old daemon, dead link) falls back
//    to the C9 browsed-directory index (file-search.ts) and the UI says so.
// Race discipline (use-import-list idiom): every effect run grabs a fresh
// requestSeq; a superseded response (query edit / leave search) never commits.
// KI-18 (冷路径 5014ms→空态 实锤): the daemon's own scan deadline is 5s and it
// answers a deadline-cut scan with `truncated: true` + whatever it found — on a
// cold big-repo walk that is ZERO matches, which used to render as 「没有匹配」.
// Tier-2 now runs behind an explicit client wait window (CONTENT_SEARCH_WAIT_MS)
// and a deadline-truncated zero-hit answer is reported as a retryable timeout
// state (contentTimedOut), UI-distinct from a true miss and from the KI-6S
// capability-gate silence. 重试 re-fires the SAME pipeline through a fresh seq.
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  FILE_SEARCH_LIMIT,
  parentDirectoryOf,
  searchFileNames,
  type FileSearchHit,
  type FileSearchSource,
} from "./file-search";
import { normalizeSearchQuery } from "./query";

/** 卡口径: debounce 沿用现 300ms 姿势 (import.tsx IMPORT_SEARCH_DEBOUNCE_MS). */
export const WORKSPACE_SEARCH_DEBOUNCE_MS = 300;
/** directory_suggestions_request caps at limit≤100 (protocol schema). */
export const NAME_SEARCH_LIMIT = 100;
/** workspace.content_search.request caps at limit≤60 (protocol schema). */
export const CONTENT_SEARCH_LIMIT = 60;
export const CONTENT_SEARCH_REQUEST_TYPE = "workspace.content_search.request";
/**
 * KI-18 client wait window for Tier-2. The daemon caps its own scan at 5s
 * (server workspace/content-search.ts SCAN_TIMEOUT_MS, deadline covering even
 * the git-ignore lookup) and answers at that point with a truncated partial —
 * so a response is expected within ~5s + event-loop lag + transport RTT. A
 * window equal to the daemon budget is a coin-flip race (observed cold path:
 * 5014ms). 8s = 5s budget + 3s slack: the daemon serves terminals/agent
 * streams on the same loop and the device rides Wi-Fi; still short enough that
 * a genuinely dead link surfaces the retryable timeout state quickly.
 */
export const CONTENT_SEARCH_WAIT_MS = 8_000;

/** Structural slice of the official directory_suggestions entry. */
export interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

/** Structural slice of the official content_search match. */
export interface ContentSearchMatch {
  path: string;
  line: number;
  preview: string;
}

/** One content hit row: file + 1-based line + the server-trimmed preview. */
export interface ContentSearchHit {
  /** `path:line` — stable FlatList key within one query. */
  key: string;
  name: string;
  /** Workspace-relative, "/"-separated (exactly what the server reports). */
  path: string;
  line: number;
  preview: string;
}

/** The two RPCs the hook needs; `DaemonClient` satisfies it structurally. */
export interface WorkspaceSearchClient {
  getDirectorySuggestions(options: {
    query: string;
    limit?: number;
    cwd?: string;
    includeFiles?: boolean;
    includeDirectories?: boolean;
    matchMode?: "fuzzy" | "suffix";
  }): Promise<{ entries: readonly DirectorySuggestionEntry[]; error: string | null }>;
  searchWorkspaceContent(options: {
    cwd: string;
    query: string;
    limit?: number;
  }): Promise<{ matches: readonly ContentSearchMatch[]; truncated: boolean }>;
}

/** Labels a Tier-1 hit carries so a row opens in the preview without re-browse. */
export interface WorkspaceSearchContext {
  serverId: string;
  hostLabel: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
}

/**
 * Map repo-wide filename suggestions onto the shared hit shape. Entries are
 * relative to cwd=workspaceRoot; only files become hits (a hit must preview).
 * Server ranking (fuzzy score) is preserved — no re-sort.
 */
export function mapSuggestionHits(
  entries: readonly DirectorySuggestionEntry[],
  ctx: WorkspaceSearchContext,
): FileSearchHit[] {
  const hits: FileSearchHit[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const name = entry.path.split(/[/\\]/).pop() || entry.path;
    const key = `${ctx.serverId}:${ctx.workspaceId}:${entry.path}`;
    hits.push({
      key,
      serverId: ctx.serverId,
      workspaceId: ctx.workspaceId,
      workspaceRoot: ctx.workspaceRoot,
      hostLabel: ctx.hostLabel,
      workspaceName: ctx.workspaceName,
      name,
      path: entry.path,
      directory: parentDirectoryOf(entry.path),
    });
  }
  return hits;
}

/** Map content matches onto rows; dedupes `path:line` repeats defensively. */
export function mapContentHits(matches: readonly ContentSearchMatch[]): ContentSearchHit[] {
  const hits: ContentSearchHit[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const key = `${match.path}:${match.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      key,
      name: match.path.split(/[/\\]/).pop() || match.path,
      path: match.path,
      line: match.line,
      preview: match.preview,
    });
  }
  return hits;
}

/**
 * KI-6S capability gate: the daemon's rpc_error for THIS request type — and
 * nothing else (timeouts/connection errors are transient, not a capability
 * verdict) — means the host predates content search. Detection rides the same
 * `name`/`requestType` shape the timeline panel gates on (use-data.ts): the
 * client's DaemonRpcError is not exported, its identity is.
 */
export function isContentSearchUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name.toLowerCase() !== "daemonrpcerror") return false;
  return (error as Error & { requestType?: unknown }).requestType === CONTENT_SEARCH_REQUEST_TYPE;
}

/** Sentinel for the KI-18 wait window elapsing — NOT an RPC error, so it never
 * trips the capability gate and never latches the host unsupported. */
class ContentSearchWaitExpiredError extends Error {
  constructor() {
    super("workspace content search exceeded the client wait window");
    this.name = "ContentSearchWaitExpiredError";
  }
}

/**
 * Rejects with ContentSearchWaitExpiredError once CONTENT_SEARCH_WAIT_MS passes
 * without the RPC settling. The RPC is not cancelled (no client-side cancel
 * contract); its late result is simply dropped by this wrapper.
 */
function withinWaitWindow<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ContentSearchWaitExpiredError()),
      CONTENT_SEARCH_WAIT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        return resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        return reject(error);
      },
    );
  });
}

export interface WorkspaceSearchResult {
  /** Tier-1 rows: repo-wide fuzzy hits, or browsed-index hits while `fallback`. */
  nameHits: FileSearchHit[];
  /** Tier-2 rows; empty while pending / unsupported / name layer had hits. */
  contentHits: ContentSearchHit[];
  contentTruncated: boolean;
  /** Tier-2 request in flight (the 「正在搜索文件内容…」 line). */
  contentPending: boolean;
  /** KI-18: Tier-2 did not answer completely — the client wait window expired,
   * or the daemon returned a deadline-truncated scan with ZERO hits. The UI
   * shows 「搜索超时，点击重试」 — never the 没有匹配 empty state, and never the
   * KI-6S capability-gate silence (an unsupported host never sets this). */
  contentTimedOut: boolean;
  /** True while the name layer is served by the browsed-directory fallback. */
  fallback: boolean;
  /** Any layer in flight — the empty state shows 搜索中 instead of 无命中. */
  pending: boolean;
  /** Re-run the current query through the same seq-guarded pipeline (重试). */
  retry: () => void;
}

const NOOP_RETRY = () => {};

const EMPTY_RESULT: WorkspaceSearchResult = {
  nameHits: [],
  contentHits: [],
  contentTruncated: false,
  contentPending: false,
  contentTimedOut: false,
  fallback: false,
  pending: false,
  retry: NOOP_RETRY,
};

/**
 * Two-tier search state for the files screen. Owns: debounce → Tier-1 RPC →
 * (zero hits → Tier-2 RPC) → commits, every commit behind the requestSeq guard.
 * `fallbackSource` (browsed-directory index) is read through a ref so explorer
 * churn never re-fires an in-flight query; hosts known to lack content search
 * are remembered per serverId for the screen's lifetime.
 */
export function useWorkspaceSearch(input: {
  active: boolean;
  query: string;
  client: WorkspaceSearchClient | null;
  fallbackSource: FileSearchSource | null;
  ctx: WorkspaceSearchContext;
}): WorkspaceSearchResult {
  const { active, client, ctx } = input;
  const { serverId, workspaceRoot } = ctx;
  const debounced = useDebouncedValue(input.query, WORKSPACE_SEARCH_DEBOUNCE_MS);
  const query = active ? normalizeSearchQuery(debounced) : "";
  const requestSeq = useRef(0);
  const fallbackSourceRef = useRef(input.fallbackSource);
  fallbackSourceRef.current = input.fallbackSource;
  // serverId of a host whose content_search rpc_error'd once — gate stays shut.
  const unsupportedHostRef = useRef<string | null>(null);
  const [result, setResult] = useState<WorkspaceSearchResult>(EMPTY_RESULT);
  // KI-18 重试: bumping the nonce re-runs the whole effect — a fresh seq is
  // grabbed at the top, so the abandoned attempt's late response dies at the
  // existing requestSeq guard (no second guard invented).
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (!active || query.length === 0 || !client || workspaceRoot.length === 0) {
      // No query / no client / no root: the browsed index still answers locally
      // when there is a query (offline posture = fallback), else clear.
      if (active && query.length > 0) {
        setResult({
          ...EMPTY_RESULT,
          nameHits: searchFileNames(
            fallbackSourceRef.current ? [fallbackSourceRef.current] : [],
            query,
            FILE_SEARCH_LIMIT,
          ),
          fallback: true,
        });
      } else {
        setResult(EMPTY_RESULT);
      }
      return undefined;
    }
    let disposed = false;
    setResult((prev) => ({ ...EMPTY_RESULT, pending: true, fallback: prev.fallback }));
    void (async () => {
      // ---- Tier 1: repo-wide fuzzy file names -------------------------------
      let nameHits: FileSearchHit[] = [];
      let fallback = false;
      try {
        const payload = await client.getDirectorySuggestions({
          cwd: workspaceRoot,
          query,
          includeFiles: true,
          includeDirectories: false,
          matchMode: "fuzzy",
          limit: NAME_SEARCH_LIMIT,
        });
        if (payload.error) throw new Error(payload.error);
        nameHits = mapSuggestionHits(payload.entries, ctx);
      } catch {
        // RPC failed / timed out / old daemon without the fuzzy path: demote to
        // the C9 browsed-directory index and say so (files.searchFallbackHint).
        fallback = true;
        nameHits = searchFileNames(
          fallbackSourceRef.current ? [fallbackSourceRef.current] : [],
          query,
          FILE_SEARCH_LIMIT,
        );
      }
      if (disposed || seq !== requestSeq.current) return;
      // ---- Tier 2: content fallback, only on a zero-hit name layer ----------
      const wantContent = nameHits.length === 0 && unsupportedHostRef.current !== serverId;
      setResult({
        ...EMPTY_RESULT,
        nameHits,
        fallback,
        contentPending: wantContent,
        pending: wantContent,
      });
      if (!wantContent) return;
      try {
        const payload = await withinWaitWindow(
          client.searchWorkspaceContent({
            cwd: workspaceRoot,
            query,
            limit: CONTENT_SEARCH_LIMIT,
          }),
        );
        if (disposed || seq !== requestSeq.current) return;
        // KI-18: a truncated scan with ZERO hits is the daemon saying "my 5s
        // deadline cut me off before I found anything" — an incomplete answer,
        // never a truthful 没有匹配. With hits on hand, truncation stays the
        // existing 「结果已截断」 hint (contentTruncated).
        setResult((prev) => ({
          ...prev,
          contentHits: mapContentHits(payload.matches),
          contentTruncated: payload.truncated,
          contentTimedOut: payload.truncated && payload.matches.length === 0,
          contentPending: false,
          pending: false,
        }));
      } catch (error) {
        // The capability latch is seq-independent (KI-6S): an rpc_error is a
        // verdict about the HOST, even if this exact request was superseded.
        if (isContentSearchUnsupportedError(error)) unsupportedHostRef.current = serverId;
        if (disposed || seq !== requestSeq.current) return;
        if (error instanceof ContentSearchWaitExpiredError) {
          // Wait window expired — retryable timeout state, NOT the miss empty
          // state. The still-pending RPC's late result is dropped by the
          // wrapper; 重试 re-fires warm and lands fast.
          setResult((prev) => ({
            ...prev,
            contentTimedOut: true,
            contentPending: false,
            pending: false,
          }));
          return;
        }
        // Transient failure (link drop etc.): silent as before — the name
        // layer already reported; a content miss never blocks or toasts.
        setResult((prev) => ({ ...prev, contentPending: false, pending: false }));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [active, client, ctx, query, retryNonce, serverId, workspaceRoot]);

  // The state object carries NOOP_RETRY (it lives in EMPTY_RESULT spreads);
  // the real callback is merged in at the boundary, stable across commits.
  return { ...result, retry };
}
