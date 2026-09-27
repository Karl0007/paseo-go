// R2-08②: the L2 长按「归档工作区」 is a real data-destruction entry (REVIEW2
// decisions #4) — it must clear the SAME risk gate the official archive flows do
// before the archive RPC fires. The gate is reused, not reimplemented:
// `selectProjectWorkspacesToArchive` (workspace/project-workspace-archive.ts) runs
// `confirmRiskyWorktreeArchive({ workspaceName, …toWorktreeArchiveRisk(entry) })`
// per record — the exact call shape sidebar-workspace-list.tsx's WorkspaceRowWithMenu
// feeds `useWorkspaceArchive` (dirty/unpushed → destructive confirmDialog; clean →
// auto-pass). The risk fields come off the session-store descriptors, the same
// live source sidebar-workspaces-view-model.ts:180-181 reads (`gitRuntime.isDirty`
// / `gitRuntime.aheadOfOrigin` / `diffStat`).
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  selectProjectWorkspacesToArchive,
  type ProjectWorkspaceArchiveEntry,
} from "@/workspace/project-workspace-archive";
import type {
  WorkspaceArchiveFailure,
  WorkspaceArchiveTarget,
} from "@/workspace/workspace-archive";

export interface WorktreeArchiveRowInput {
  serverId: string;
  /** Every merged record id — the archive-all payload (pre-merge). */
  workspaceIds: string[];
  /** The merged row's display name — fallback when the store lost the record. */
  name: string;
}

/** One gate entry per merged record, risks read live from the session store. */
export function buildWorktreeArchiveEntries(
  row: WorktreeArchiveRowInput,
  descriptorOf: (serverId: string, workspaceId: string) => WorkspaceDescriptor | undefined,
): ProjectWorkspaceArchiveEntry[] {
  return row.workspaceIds.map((workspaceId) => {
    const descriptor = descriptorOf(row.serverId, workspaceId);
    return {
      serverId: row.serverId,
      workspaceId,
      // L2 行 = worktree 层; a record the store never carried still gets the
      // worktree gate — with null risks the official confirm auto-passes, so the
      // missing descriptor can only ever ADD a confirm, never skip one.
      workspaceKind: descriptor?.workspaceKind ?? "worktree",
      name: descriptor?.name ?? row.name,
      archiveHasUncommittedChanges: descriptor?.gitRuntime?.isDirty ?? null,
      archiveUnpushedCommitCount: descriptor?.gitRuntime?.aheadOfOrigin ?? null,
      diffStat: descriptor?.diffStat ?? null,
    };
  });
}

/**
 * 先闸后归档: gate every merged record first, then archive exactly the confirmed
 * targets in one optimistic batch. All-declined = pure no-op (nothing attempted).
 * `select` is the injectable seam over the official wrapper (test posture of
 * project-workspace-archive.test.ts); `archive` is the caller's RPC wiring.
 */
export async function archiveWorktreeRowWithRiskGate(input: {
  row: WorktreeArchiveRowInput;
  descriptorOf: (serverId: string, workspaceId: string) => WorkspaceDescriptor | undefined;
  select?: typeof selectProjectWorkspacesToArchive;
  archive: (targets: WorkspaceArchiveTarget[]) => Promise<WorkspaceArchiveFailure[]>;
}): Promise<{ attempted: WorkspaceArchiveTarget[]; failures: WorkspaceArchiveFailure[] }> {
  const select = input.select ?? selectProjectWorkspacesToArchive;
  const confirmed = await select(buildWorktreeArchiveEntries(input.row, input.descriptorOf));
  if (confirmed.length === 0) {
    return { attempted: [], failures: [] };
  }
  const failures = await input.archive(confirmed);
  return { attempted: confirmed, failures };
}
