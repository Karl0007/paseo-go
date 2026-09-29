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
import { useEffect, useRef, useState } from "react";
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

export interface WorkspaceSearchResult {
  /** Tier-1 rows: repo-wide fuzzy hits, or browsed-index hits while `fallback`. */
  nameHits: FileSearchHit[];
  /** Tier-2 rows; empty while pending / unsupported / name layer had hits. */
  contentHits: ContentSearchHit[];
  contentTruncated: boolean;
  /** Tier-2 request in flight (the 「正在搜索文件内容…」 line). */
  contentPending: boolean;
  /** True while the name layer is served by the browsed-directory fallback. */
  fallback: boolean;
  /** Any layer in flight — the empty state shows 搜索中 instead of 无命中. */
  pending: boolean;
}

const EMPTY_RESULT: WorkspaceSearchResult = {
  nameHits: [],
  contentHits: [],
  contentTruncated: false,
  contentPending: false,
  fallback: false,
  pending: false,
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
        nameHits,
        contentHits: [],
        contentTruncated: false,
        contentPending: wantContent,
        fallback,
        pending: wantContent,
      });
      if (!wantContent) return;
      try {
        const payload = await client.searchWorkspaceContent({
          cwd: workspaceRoot,
          query,
          limit: CONTENT_SEARCH_LIMIT,
        });
        if (disposed || seq !== requestSeq.current) return;
        setResult((prev) => ({
          ...prev,
          contentHits: mapContentHits(payload.matches),
          contentTruncated: payload.truncated,
          contentPending: false,
          pending: false,
        }));
      } catch (error) {
        if (isContentSearchUnsupportedError(error)) unsupportedHostRef.current = serverId;
        // Silent either way (capability gate OR transient failure): the name
        // layer already reported; a content miss never blocks or toasts.
        if (disposed || seq !== requestSeq.current) return;
        setResult((prev) => ({ ...prev, contentPending: false, pending: false }));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [active, client, ctx, query, serverId, workspaceRoot]);

  return result;
}
