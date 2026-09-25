// 工作区文件名搜索 (card C9, DESIGN §5/§8): the protocol has NO filename-search RPC —
// `file_explorer_request` only serves mode list|file (protocol messages.ts), and live
// probes against both dev daemons (v0.9.2) answer mode:"search" with
// `unknown_schema` (see card report). Per the C9 ruling the shell therefore filters
// the ALREADY-LOADED directory tree client-side: everything the session-store
// explorer cache holds (directories browsed in this app run via the 文件浏览屏).
// Known limitation, surfaced in the UI hint: 只覆盖已浏览目录 — no repo-wide scan,
// and none may be invented (content search awaits upstream PR #4659).
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

function parentDirectoryOf(path: string): string {
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
