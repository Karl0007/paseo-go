// The session-store `fileExplorer` Map key contract (cards C9/C13-F1). The browse
// screen WRITES explorer state under `workspace:{id}` (falling back to
// `root:{path}` when no workspaceId is in scope); the 工作区 file-name search READS
// back exactly the `workspace:` states (the preview needs a workspaceId, so
// `root:` states never participate). Both sides import this module — the string
// lives once, and a drift between writer and reader becomes a type/test failure
// instead of a silent zero-hit search (the C13-F1 phantom's suspicion surface).
export const WORKSPACE_EXPLORER_STATE_PREFIX = "workspace:";
export const ROOT_EXPLORER_STATE_PREFIX = "root:";

export interface FileExplorerWorkspaceScope {
  workspaceId?: string | null;
  workspaceRoot?: string | null;
}

export function normalizeWorkspaceValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildWorkspaceExplorerStateKey(scope: FileExplorerWorkspaceScope): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceValue(scope.workspaceId);
  if (normalizedWorkspaceId) {
    return `${WORKSPACE_EXPLORER_STATE_PREFIX}${normalizedWorkspaceId}`;
  }
  const normalizedWorkspaceRoot = normalizeWorkspaceValue(scope.workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return null;
  }
  return `${ROOT_EXPLORER_STATE_PREFIX}${normalizedWorkspaceRoot}`;
}
