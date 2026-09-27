// R2-08② (回炉 after the CLOSE-DEV3 device FAIL, b2-09/b2-10): the L2 长按「归档工作区」
// is a real data-destruction entry (REVIEW2 decisions #4) — it must clear the SAME risk
// gate the official archive flows do before the archive RPC fires. The gate is reused,
// not reimplemented: `selectProjectWorkspacesToArchive`
// (workspace/project-workspace-archive.ts) runs
// `confirmRiskyWorktreeArchive({ workspaceName, …toWorktreeArchiveRisk(entry) })` per
// record — the exact call shape sidebar-workspace-list.tsx's WorkspaceRowWithMenu feeds
// `useWorkspaceArchive`.
//
// Why the first cut stood permanently open on device: the risk fields were read off the
// session-store descriptors (gitRuntime/diffStat) — the same live source
// sidebar-workspaces-view-model.ts:180-181 reads — but the server fills `gitRuntime`
// only from the lazy git-observer snapshot: describeWorkspaceRecordWithGitData returns
// the base descriptor WITHOUT gitRuntime while workspaceGitService.peekSnapshot(cwd)
// has not resolved (server session.ts), and `confirmRiskyWorktreeArchive` has no reason
// to show for null risks — it auto-passes (worktree-archive-warning.ts). The official
// sidebar reads the same null fields and auto-passes too (upstream defect, filed
// separately); the official workspace screen is not exposed because it overlays the
// live checkout status and disables archive while risk is unresolved
// (git/use-actions.tsx resolveWorkspaceArchiveRisk/canArchiveWorkspace).
//
// Two layers, both required:
//  1. 真值源: at action time, overlay each merged record's risks from the official live
//     checkout-status query — `ensureCheckoutStatus` (git/checkout-status-cache.ts, the
//     same react-query door the sidebar/screen status hooks and the
//     new-workspace-screen create path use) over `client.getCheckoutStatus(cwd)`, which
//     the server answers with an awaited `workspaceGitService.getSnapshot(cwd)` — one
//     query per distinct worktree directory. Precedence `live ?? descriptor` mirrors
//     resolveWorkspaceArchiveRisk.
//  2. fail-closed: if a worktree record's risks are STILL unresolved (isDirty and
//     aheadOfOrigin both nullish — exactly the auto-pass shape), never silently archive:
//     raise the shell's generic warning confirm (paseoGo workspace.archiveGate.*)
//     instead. Known-clean keeps auto-passing; known-risky keeps the official
//     destructive dialog untouched.
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { i18n } from "@/i18n/i18next";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  buildWorktreeArchiveConfirmationMessage,
  confirmRiskyWorktreeArchive,
  type WorktreeArchiveConfirmationInput,
} from "@/git/worktree-archive-warning";
import { ensureCheckoutStatus } from "@/git/checkout-status-cache";
import { queryClient } from "@/data/query-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { confirmDialog } from "@/utils/confirm-dialog";
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

/** The two destructive risk fields the official live checkout-status query answers. */
export interface WorktreeArchiveLiveRisk {
  isDirty: boolean | null;
  aheadOfOrigin: number | null;
}

/** Injectable seam over the official query (test posture of this file). */
export type WorktreeArchiveRiskFetcher = (
  serverId: string,
  cwd: string,
) => Promise<WorktreeArchiveLiveRisk | null>;

/**
 * Default live-risk source: the official checkout-status query. A missing client or a
 * failed RPC resolves to `null` (= still unknown → the fail-closed dialog downstream),
 * never to "clean".
 */
export const fetchWorktreeArchiveLiveRisk: WorktreeArchiveRiskFetcher = async (serverId, cwd) => {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    return null;
  }
  try {
    const status = await ensureCheckoutStatus({ queryClient, client, serverId, cwd });
    return { isDirty: status.isDirty ?? null, aheadOfOrigin: status.aheadOfOrigin ?? null };
  } catch {
    return null;
  }
};

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
      // L2 行 = worktree 层; a record the store never carried still gets the worktree
      // gate. Its null risks no longer auto-pass — see confirmGateRisk below.
      workspaceKind: descriptor?.workspaceKind ?? "worktree",
      name: descriptor?.name ?? row.name,
      archiveHasUncommittedChanges: descriptor?.gitRuntime?.isDirty ?? null,
      archiveUnpushedCommitCount: descriptor?.gitRuntime?.aheadOfOrigin ?? null,
      diffStat: descriptor?.diffStat ?? null,
    };
  });
}

/**
 * Overlay the official live checkout status onto the descriptor-layer entries. One
 * query per DISTINCT physical directory (the daemon reports one checkout under both
 * `C:\x` and `c:/x` shapes — R2-09 identity — so dedupe goes through
 * normalizeWorkspacePath while the RPC carries the raw cwd). Live wins over the
 * descriptor exactly like resolveWorkspaceArchiveRisk (git/use-actions.tsx).
 */
async function overlayLiveCheckoutRisk(
  entries: ProjectWorkspaceArchiveEntry[],
  serverId: string,
  descriptorOf: (serverId: string, workspaceId: string) => WorkspaceDescriptor | undefined,
  fetchLiveRisk: WorktreeArchiveRiskFetcher,
): Promise<ProjectWorkspaceArchiveEntry[]> {
  const cwdByKey = new Map<string, string>();
  const keyByWorkspaceId = new Map<string, string>();
  for (const entry of entries) {
    // Only worktree-kind records are confirmed by the official wrapper; directory
    // records skip the gate upstream, so never spend an RPC on them here.
    if (entry.workspaceKind !== "worktree") {
      continue;
    }
    const cwd = descriptorOf(serverId, entry.workspaceId)?.workspaceDirectory?.trim();
    if (!cwd) {
      continue;
    }
    const key = normalizeWorkspacePath(cwd) ?? cwd;
    if (!cwdByKey.has(key)) {
      cwdByKey.set(key, cwd);
    }
    keyByWorkspaceId.set(entry.workspaceId, key);
  }
  if (cwdByKey.size === 0) {
    return entries;
  }

  const riskByKey = new Map<string, WorktreeArchiveLiveRisk | null>();
  await Promise.all(
    [...cwdByKey].map(async ([key, cwd]) => {
      riskByKey.set(key, await fetchLiveRisk(serverId, cwd).catch(() => null));
    }),
  );

  return entries.map((entry) => {
    const live = riskByKey.get(keyByWorkspaceId.get(entry.workspaceId) ?? "");
    if (!live) {
      return entry;
    }
    return {
      ...entry,
      archiveHasUncommittedChanges: live.isDirty ?? entry.archiveHasUncommittedChanges,
      archiveUnpushedCommitCount: live.aheadOfOrigin ?? entry.archiveUnpushedCommitCount,
    };
  });
}

/**
 * The device-事故 shape: neither the store nor the live query ever resolved a risk
 * value. The official confirm would auto-pass on exactly this input — the shell asks a
 * generic destructive warning instead (fail-closed).
 */
export function isWorktreeArchiveRiskUnresolved(input: WorktreeArchiveConfirmationInput): boolean {
  return input.isDirty == null && input.aheadOfOrigin == null;
}

export function confirmUnknownWorktreeArchiveRisk(workspaceName: string): Promise<boolean> {
  return confirmDialog({
    title: i18n.t(`${SHELL_I18N_NAMESPACE}:workspace.archiveGate.unknownRiskTitle`, {
      workspaceName,
    }),
    message: i18n.t(`${SHELL_I18N_NAMESPACE}:workspace.archiveGate.unknownRiskMessage`),
    confirmLabel: i18n.t(`${SHELL_I18N_NAMESPACE}:workspace.archiveGate.confirm`),
    cancelLabel: i18n.t(`${SHELL_I18N_NAMESPACE}:workspace.archiveGate.cancel`),
    destructive: true,
  });
}

/**
 * Per-record gate: known risks keep the OFFICIAL dialog verbatim (same default-labels
 * posture as the sidebar rows); unresolved risks get the generic warning; a resolved
 * clean record auto-passes exactly as upstream does.
 */
async function confirmGateRisk(
  input: WorktreeArchiveConfirmationInput,
  confirmUnknownRisk: (workspaceName: string) => Promise<boolean>,
): Promise<boolean> {
  if (buildWorktreeArchiveConfirmationMessage(input)) {
    return await confirmRiskyWorktreeArchive(input);
  }
  if (isWorktreeArchiveRiskUnresolved(input)) {
    return await confirmUnknownRisk(input.workspaceName);
  }
  return true;
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
  /** Official live checkout-status seam; defaults to the real query. */
  fetchLiveRisk?: WorktreeArchiveRiskFetcher;
  /** Fail-closed dialog seam; defaults to the shell's localized generic warning. */
  confirmUnknownRisk?: (workspaceName: string) => Promise<boolean>;
  select?: typeof selectProjectWorkspacesToArchive;
  archive: (targets: WorkspaceArchiveTarget[]) => Promise<WorkspaceArchiveFailure[]>;
}): Promise<{ attempted: WorkspaceArchiveTarget[]; failures: WorkspaceArchiveFailure[] }> {
  const select = input.select ?? selectProjectWorkspacesToArchive;
  const fetchLiveRisk = input.fetchLiveRisk ?? fetchWorktreeArchiveLiveRisk;
  const confirmUnknownRisk = input.confirmUnknownRisk ?? confirmUnknownWorktreeArchiveRisk;
  const entries = await overlayLiveCheckoutRisk(
    buildWorktreeArchiveEntries(input.row, input.descriptorOf),
    input.row.serverId,
    input.descriptorOf,
    fetchLiveRisk,
  );
  const confirmed = await select(entries, (workspace) =>
    confirmGateRisk(workspace, confirmUnknownRisk),
  );
  if (confirmed.length === 0) {
    return { attempted: [], failures: [] };
  }
  const failures = await input.archive(confirmed);
  return { attempted: confirmed, failures };
}
