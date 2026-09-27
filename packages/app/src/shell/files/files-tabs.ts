// 文件屏三段页签的纯逻辑 (card C27, DESIGN §14.9): 文件 | diff | git 记录 lives as
// in-screen state only (裁定 4: 不入 persist、不进 URL), so the state machine is
// testable without React. The git sections' selectability rides the SAME checkout
// status the embedded ChangesSurface reads (useCheckoutStatusQuery → status.isGit);
// these helpers only answer "may a git section be shown / stay shown".
import type { FileSearchEntry, FileSearchSource } from "@/shell/search/file-search";

export type FilesScreenTab = "files" | "diff" | "git";

export const FILES_SCREEN_TABS: readonly FilesScreenTab[] = ["files", "diff", "git"];

/** Default tab, and the fallback for anything unknown (a future route param, a
 * stale value): 文件. Never throws, never returns undefined. */
export function resolveFilesScreenTab(raw: unknown): FilesScreenTab {
  return typeof raw === "string" && (FILES_SCREEN_TABS as readonly string[]).includes(raw)
    ? (raw as FilesScreenTab)
    : "files";
}

/** diff/git are grayed only while the checkout is KNOWN non-git. While the status
 * is still loading (null/undefined) they stay selectable — graying on unknown
 * would flash, and the embedded panes carry their own loading idiom. */
export function gitTabsDisabled(isGit: boolean | null | undefined): boolean {
  return isGit === false;
}

/** A git section can never remain visible once the checkout turns non-git (the
 * status push may land while the user sits on diff/git): fall back to 文件. The
 * stored selection is untouched, so a later git checkout restores the user's tab. */
export function constrainFilesScreenTab(
  tab: FilesScreenTab,
  isGit: boolean | null | undefined,
): FilesScreenTab {
  return gitTabsDisabled(isGit) && tab !== "files" ? "files" : tab;
}

/**
 * 页内搜索 scope (C27 裁定 3): ONLY this workspace's browsed directories. The
 * browsed groups come from `collectBrowsedWorkspaces` (C9/C13-F1 contract); this
 * filters to the screen's workspace and merges every loaded directory listing
 * into the single `FileSearchSource` the shared matcher expects. Null = nothing
 * browsed yet (the empty state then says the scope out loud). The returned source
 * carries the full (serverId, workspaceId, workspaceRoot) triple so a hit opens
 * in the preview without a re-browse.
 */
export function buildWorkspaceFileSearchSource(input: {
  serverId: string;
  hostLabel: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  browsed: readonly { workspaceId: string; entries: readonly FileSearchEntry[] }[];
}): FileSearchSource | null {
  const entries: FileSearchEntry[] = [];
  for (const group of input.browsed) {
    if (group.workspaceId !== input.workspaceId) continue;
    entries.push(...group.entries);
  }
  if (entries.length === 0) return null;
  return {
    serverId: input.serverId,
    hostLabel: input.hostLabel,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    workspaceRoot: input.workspaceRoot,
    entries,
  };
}
