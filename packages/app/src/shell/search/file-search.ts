// 浏览目录本地索引 (card C9, DESIGN §5/§8; demoted to FALLBACK by KI-6): since
// KI-6 the files screen searches the WHOLE repository through the existing
// `directory_suggestions_request` RPC (see workspace-search.ts Tier 1). This
// module keeps two jobs: (a) the shared FileSearchHit/row shape + the browsed
// index (session-store explorer cache = directories opened in this app run),
// which now serves ONLY the Tier-1-RPC-failure / old-daemon fallback; (b) the
// pure matcher the fallback filters with. The UI hint states the narrower
// scope whenever `fallback` is on.
import { WORKSPACE_EXPLORER_STATE_PREFIX } from "@/file-explorer/state-keys";
import { normalizeSearchQuery } from "./query";

/** Structural slice of the official ExplorerEntry the matcher needs. */
export interface FileSearchEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

/** One browsed scope: a workspace on a host plus every directory entry loaded for it. */
export interface FileSearchSource {
  serverId: string;
  hostLabel: string;
  workspaceId: string;
  workspaceName: string;
  /** Absolute workspace root (preview needs it to read the file). */
  workspaceRoot: string;
  entries: Iterable<FileSearchEntry>;
}

export interface FileSearchHit {
  /** `serverId:workspaceId:path` — stable FlatList key, also the dedupe identity. */
  key: string;
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  hostLabel: string;
  workspaceName: string;
  name: string;
  /** Workspace-relative path, exactly as the explorer reports it. */
  path: string;
  /** Parent directory for the subtitle ("." for the workspace root). */
  directory: string;
}

/** Guard rail for the (client-side) result list; matches are cheap but the UI is not. */
export const FILE_SEARCH_LIMIT = 60;

/** Structural slice of AgentFileExplorerState the index reads. */
export interface FileSearchExplorerState {
  directories: ReadonlyMap<string, { entries: readonly FileSearchEntry[] }>;
}

/**
 * Store-key contract half of the search index (C13-F1): flatten every loaded
 * directory listing per workspace. Only `workspace:{id}` states participate —
 * the preview needs a workspaceId, so `root:` states are skipped. The keys come
 * from `buildWorkspaceExplorerStateKey` (shared module), so writer and reader
 * cannot drift silently.
 */
export function collectBrowsedWorkspaces(
  fileExplorer: ReadonlyMap<string, FileSearchExplorerState>,
): { workspaceId: string; entries: FileSearchEntry[] }[] {
  const out: { workspaceId: string; entries: FileSearchEntry[] }[] = [];
  for (const [stateKey, explorer] of fileExplorer) {
    if (!stateKey.startsWith(WORKSPACE_EXPLORER_STATE_PREFIX)) continue;
    const workspaceId = stateKey.slice(WORKSPACE_EXPLORER_STATE_PREFIX.length);
    const entries: FileSearchEntry[] = [];
    for (const directory of explorer.directories.values()) {
      entries.push(...directory.entries);
    }
    out.push({ workspaceId, entries });
  }
  return out;
}

/** Shared with the KI-6 repo-wide search mapping (workspace-search.ts). */
export function parentDirectoryOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash < 0) return ".";
  return slash === 0 ? path.slice(0, 1) : path.slice(0, slash);
}

/**
 * Substring match on file names across all sources. Ranking: name-prefix hits
 * first, then shorter names (a tighter fit), then path order for stability.
 * Directories never match — a hit must be openable in the preview.
 */
export function searchFileNames(
  sources: readonly FileSearchSource[],
  query: string,
  limit: number = FILE_SEARCH_LIMIT,
): FileSearchHit[] {
  const normalized = normalizeSearchQuery(query);
  if (normalized.length === 0) return [];
  const hits = new Map<string, FileSearchHit>();
  for (const source of sources) {
    for (const entry of source.entries) {
      if (entry.kind !== "file") continue;
      const name = entry.name.toLowerCase();
      if (!name.includes(normalized)) continue;
      const key = `${source.serverId}:${source.workspaceId}:${entry.path}`;
      if (hits.has(key)) continue;
      hits.set(key, {
        key,
        serverId: source.serverId,
        workspaceId: source.workspaceId,
        workspaceRoot: source.workspaceRoot,
        hostLabel: source.hostLabel,
        workspaceName: source.workspaceName,
        name: entry.name,
        path: entry.path,
        directory: parentDirectoryOf(entry.path),
      });
    }
  }
  const ranked = [...hits.values()].sort((left, right) => {
    const leftPrefix = left.name.toLowerCase().startsWith(normalized) ? 0 : 1;
    const rightPrefix = right.name.toLowerCase().startsWith(normalized) ? 0 : 1;
    return (
      leftPrefix - rightPrefix ||
      left.name.length - right.name.length ||
      left.key.localeCompare(right.key)
    );
  });
  return ranked.slice(0, Math.max(0, limit));
}
