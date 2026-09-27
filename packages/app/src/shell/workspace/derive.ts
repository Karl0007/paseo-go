// 工作区 tab three-layer tree derivation (DESIGN §14.8, card C26): pure regrouping of
// the official useProjects() output into host → L1 工程 → L2 worktree → L3 session.
//
// The structural ruling (v2): the workspace tab mirrors the data model. L1 is the
// project (projectId key, custom name ‖ name); L2 is the PHYSICAL worktree — the
// daemon deliberately keeps one record per creation, so the same directory can carry
// many records upstream (measured: 17 records for one cwd). The display layer merges
// records by physical identity (normalized cwd + branch) into ONE row; the data layer
// stays untouched. The representative record (the one whose files route we push and
// whose title‖name we show) is the record with the newest activity — the descriptor
// has no updatedAt field, so agent activity is the honest proxy for 「最近更新」.
// L3 hangs the sessions of EVERY merged record (workspaceId set membership).
//
// Identity comparison is deliberately conservative (the preview-root.ts posture):
// separators unify to "/", trailing separators drop, case is PRESERVED (a case-fold
// would merge two genuinely different directories on a case-sensitive host). Records
// without a usable cwd never merge — each is its own L2 keyed by workspace id.
//
// Badges are the SAME SOURCE as the 对话 tab's live lights (R2-06): 活跃 = the
// official bucket (deriveAgentStateBucket via deriveSidebarStateBucket) landing
// on running/needs_input — initializing is bucket-done and never counted, a
// count-only permission request always is; finished/error attention is history.
// L2 counts its merged records' agents; L1 aggregates its L2s. needs_input
// outranks running for the badge colour (badgeTone).
//
// No React, no stores — the screen feeds it hook output; the unit tests feed fixtures.
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { ProjectSummary, WorkspaceSummary } from "@/utils/projects";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { finiteTimeMs } from "@/shell/chats/derive";

export interface WorkspaceTreeHost {
  serverId: string;
  label: string;
}

// Structural subset of AggregatedAgent the badge/recency/session maths needs. The
// screen passes the live AggregatedAgent payloads (generic A), so the rows carry the
// full payload for rendering (title/provider/status light) without a second lookup.
export interface WorkspaceTreeAgent {
  serverId: string;
  id: string;
  workspaceId?: string;
  status: AgentLifecycleStatus;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  lastActivityAt: Date;
  attentionTimestamp?: Date | null;
  /** AggregatedAgent carries it; the official needs_input edge is count>0 ∨
   * attentionReason==="permission" — the count-only shape must flow through. */
  pendingPermissionCount?: number;
}

/** L3: one session hanging under a worktree row. */
export interface WorkspaceTreeSession<A extends WorkspaceTreeAgent = WorkspaceTreeAgent> {
  /** `${serverId}:${agentId}` — the readState/pins key, same as the 对话 tab. */
  key: string;
  agentId: string;
  /** Host-domain last-event stamp (chatLastEventAt family). */
  lastEventAt: number;
  /** isWorkspaceAgentActive — the row's live state, not the badge maths. */
  active: boolean;
  /** Permission-waiting: what colours the ancestor badges orange. */
  needsInput: boolean;
  agent: A;
}

/** L2: a physically-merged worktree row (one cwd+branch, N daemon records). */
export interface ShellWorktreeRow<A extends WorkspaceTreeAgent = WorkspaceTreeAgent> {
  /** Stable list key: host + project + physical identity (or record id when cwd-less). */
  key: string;
  serverId: string;
  projectId: string;
  /** Representative record (newest activity) — the files-route target. */
  workspaceId: string;
  /** Every merged record id — L3 membership and the archive-all payload. */
  workspaceIds: string[];
  /** Worktree display name: representative record's title ‖ name (摘要在此层归位). */
  name: string;
  /** Normalized cwd ("" when no record carried one) — path tail + copy. */
  cwd: string;
  branch: string | null;
  /** 活跃 agent 数角标 over every merged record. */
  activeCount: number;
  /** needs_input 数: >0 colours the badge orange (badgeTone). */
  needsInputCount: number;
  /** Newest agent activity over every merged record; null when none ever ran. */
  lastUsedAt: number | null;
  /** chatLastEventAt 倒序. */
  sessions: WorkspaceTreeSession<A>[];
}

/** L1: a project row (one projectId on one host). */
export interface ShellProjectRow<A extends WorkspaceTreeAgent = WorkspaceTreeAgent> {
  /** `${serverId}:${projectId}` — expansion-state key. */
  key: string;
  serverId: string;
  projectId: string;
  /** Project display name (custom name falls back to name). */
  name: string;
  /** Aggregated over the L2s. */
  activeCount: number;
  needsInputCount: number;
  lastUsedAt: number | null;
  worktrees: ShellWorktreeRow<A>[];
}

export interface ShellHostSection<A extends WorkspaceTreeAgent = WorkspaceTreeAgent> {
  serverId: string;
  label: string;
  status: HostRuntimeConnectionStatus;
  isOnline: boolean;
  projects: ShellProjectRow<A>[];
}

export interface BuildWorkspaceTreeInput<A extends WorkspaceTreeAgent = WorkspaceTreeAgent> {
  hosts: readonly WorkspaceTreeHost[];
  statuses: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  projects: readonly ProjectSummary[];
  agents: readonly A[];
  /**
   * `${serverId}:${workspaceId}` → the record's workspace directory (store-normalized).
   * The screen builds it from the session-store descriptors; WorkspaceSummary carries
   * no path, so the cwd axis of the physical identity arrives through this map.
   * Missing entry = cwd-less record (never merges).
   */
  workspacePaths: ReadonlyMap<string, string>;
}

// 活跃 = the official bucket's live set: running or needs_input. The bucket is
// the exact function the 对话 tab's row light consumes (R2-06 — same source,
// no hand-rolled enumeration): `initializing` files under done (the row light
// is grey — nothing runs yet), permission requests count on
// `pendingPermissionCount > 0` alone, and finished/error attention stays
// history, not activity — the badge mirrors the live lights, never the
// workspace's total session count.
function workspaceAgentBucket(agent: WorkspaceTreeAgent) {
  return deriveSidebarStateBucket({
    status: agent.status,
    requiresAttention: agent.requiresAttention === true,
    attentionReason: agent.attentionReason ?? null,
    pendingPermissionCount: agent.pendingPermissionCount ?? 0,
  });
}

export function isWorkspaceAgentActive(agent: WorkspaceTreeAgent): boolean {
  const bucket = workspaceAgentBucket(agent);
  return bucket === "running" || bucket === "needs_input";
}

/** Permission-waiting (needs_input): the orange-badge condition — the official
 * bucket edge itself (count-only requests included). */
export function isWorkspaceAgentNeedsInput(agent: WorkspaceTreeAgent): boolean {
  return workspaceAgentBucket(agent) === "needs_input";
}

/** Host-domain last event (chatLastEventAtFromAgent twin over the derive input).
 *  R2-14: null = every host date is garbage (untrusted bare-z.string() wire
 *  fields) — callers treat it like "never ran"; NaN never enters the tree. */
export function workspaceAgentLastEventAt(agent: WorkspaceTreeAgent): number | null {
  const activity = finiteTimeMs(agent.lastActivityAt);
  const attention = finiteTimeMs(agent.attentionTimestamp);
  if (activity === null && attention === null) return null;
  return Math.max(activity ?? 0, attention ?? 0);
}

/**
 * Badge colour tone for the L1/L2 count pill: needs_input outranks running
 * (orange), a plain live count is static green, zero renders nothing.
 */
export function badgeTone(activeCount: number, needsInputCount: number): "needs" | "active" | null {
  if (needsInputCount > 0) return "needs";
  if (activeCount > 0) return "active";
  return null;
}

/**
 * The path tail a worktree row shows under its title: last "/"-separated segment of
 * the normalized cwd. "" for a cwd-less row; a bare root stays "/".
 */
export function pathTail(path: string): string {
  const raw = path.trim();
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed.length === 0) return raw.length > 0 ? "/" : "";
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

interface RecordStats {
  activeCount: number;
  needsInputCount: number;
  lastUsedAt: number | null;
}

// Per-record (serverId:workspaceId) agent stats — the merge inputs.
function indexAgents(agents: readonly WorkspaceTreeAgent[]): Map<string, RecordStats> {
  const stats = new Map<string, RecordStats>();
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    const key = `${agent.serverId}:${agent.workspaceId}`;
    let entry = stats.get(key);
    if (!entry) {
      entry = { activeCount: 0, needsInputCount: 0, lastUsedAt: null };
      stats.set(key, entry);
    }
    if (isWorkspaceAgentActive(agent)) entry.activeCount += 1;
    if (isWorkspaceAgentNeedsInput(agent)) entry.needsInputCount += 1;
    const at = workspaceAgentLastEventAt(agent);
    if (at !== null && (entry.lastUsedAt === null || at > entry.lastUsedAt)) {
      entry.lastUsedAt = at;
    }
  }
  return stats;
}

function displayName(title: string | null | undefined, fallback: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : fallback;
}

// 排序稳定: 活跃数 first (live work rises), then 最近使用 (never-used sinks), then
// 字典序 so equal rows keep a deterministic order across re-derives.
function compareTreeNodes(
  left: { activeCount: number; lastUsedAt: number | null; name: string },
  right: { activeCount: number; lastUsedAt: number | null; name: string },
): number {
  if (left.activeCount !== right.activeCount) return right.activeCount - left.activeCount;
  if (left.lastUsedAt !== null || right.lastUsedAt !== null) {
    if (left.lastUsedAt === null) return 1;
    if (right.lastUsedAt === null) return -1;
    if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
  }
  return left.name.localeCompare(right.name);
}

/**
 * Physical identity of a workspace record: normalized cwd + branch. A record with no
 * usable cwd gets its own id-keyed identity (conservative: unknown ≠ unknown).
 */
function worktreeIdentity(cwd: string, branch: string | null, workspaceId: string): string {
  if (!cwd) return `i:${workspaceId}`;
  return `c:${cwd}\u0000${branch ?? ""}`;
}

interface WorktreeDraft {
  identity: string;
  serverId: string;
  projectId: string;
  /** Newest-activity record so far — the representative (title + files target). */
  repId: string;
  repLastUsedAt: number | null;
  repName: string;
  workspaceIds: string[];
  cwd: string;
  branch: string | null;
  activeCount: number;
  needsInputCount: number;
  lastUsedAt: number | null;
}

interface ProjectDraft {
  name: string;
  worktrees: Map<string, WorktreeDraft>;
}

// One session row per agent, bucketed under its (host, workspace-record) key.
function indexSessions<A extends WorkspaceTreeAgent>(
  agents: readonly A[],
): Map<string, WorkspaceTreeSession<A>[]> {
  const sessionsByRecord = new Map<string, WorkspaceTreeSession<A>[]>();
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    const key = `${agent.serverId}:${agent.workspaceId}`;
    const session: WorkspaceTreeSession<A> = {
      key: `${agent.serverId}:${agent.id}`,
      agentId: agent.id,
      lastEventAt: workspaceAgentLastEventAt(agent) ?? 0,
      active: isWorkspaceAgentActive(agent),
      needsInput: isWorkspaceAgentNeedsInput(agent),
      agent,
    };
    const list = sessionsByRecord.get(key);
    if (list) list.push(session);
    else sessionsByRecord.set(key, [session]);
  }
  return sessionsByRecord;
}

// Merge one workspace record into its physical-identity draft: counts sum, recency
// maxes, and 代表记录 = updatedAt(≈activity)最新 — a newer-activity record takes over
// the row's title and files-route target; null-activity records never displace one.
function mergeRecordIntoDraft(
  worktrees: Map<string, WorktreeDraft>,
  serverId: string,
  projectId: string,
  workspace: WorkspaceSummary,
  cwd: string,
  stats: RecordStats | undefined,
): void {
  const lastUsedAt = stats?.lastUsedAt ?? null;
  const identity = worktreeIdentity(cwd, workspace.currentBranch, workspace.id);
  const draft = worktrees.get(identity);
  if (!draft) {
    worktrees.set(identity, {
      identity,
      serverId,
      projectId,
      repId: workspace.id,
      repLastUsedAt: lastUsedAt,
      repName: displayName(workspace.title, workspace.name),
      workspaceIds: [workspace.id],
      cwd,
      branch: workspace.currentBranch,
      activeCount: stats?.activeCount ?? 0,
      needsInputCount: stats?.needsInputCount ?? 0,
      lastUsedAt,
    });
    return;
  }
  draft.workspaceIds.push(workspace.id);
  draft.activeCount += stats?.activeCount ?? 0;
  draft.needsInputCount += stats?.needsInputCount ?? 0;
  if (lastUsedAt !== null && (draft.lastUsedAt === null || lastUsedAt > draft.lastUsedAt)) {
    draft.lastUsedAt = lastUsedAt;
  }
  if (lastUsedAt !== null && (draft.repLastUsedAt === null || lastUsedAt > draft.repLastUsedAt)) {
    draft.repLastUsedAt = lastUsedAt;
    draft.repId = workspace.id;
    draft.repName = displayName(workspace.title, workspace.name);
  }
}

// L2 assembly: L3 membership spans EVERY merged record (chatLastEventAt 倒序).
function buildWorktreeRow<A extends WorkspaceTreeAgent>(
  draft: WorktreeDraft,
  sessionsByRecord: ReadonlyMap<string, WorkspaceTreeSession<A>[]>,
): ShellWorktreeRow<A> {
  const sessions: WorkspaceTreeSession<A>[] = [];
  for (const workspaceId of draft.workspaceIds) {
    const list = sessionsByRecord.get(`${draft.serverId}:${workspaceId}`);
    if (list) sessions.push(...list);
  }
  sessions.sort(
    (left, right) => right.lastEventAt - left.lastEventAt || left.key.localeCompare(right.key),
  );
  return {
    key: `${draft.serverId}:${draft.projectId}:wt:${draft.identity}`,
    serverId: draft.serverId,
    projectId: draft.projectId,
    workspaceId: draft.repId,
    workspaceIds: draft.workspaceIds,
    name: draft.repName,
    cwd: draft.cwd,
    branch: draft.branch,
    activeCount: draft.activeCount,
    needsInputCount: draft.needsInputCount,
    lastUsedAt: draft.lastUsedAt,
    sessions,
  };
}

// L1 assembly: the badge aggregates the L2s it hides.
function buildProjectRow<A extends WorkspaceTreeAgent>(
  serverId: string,
  projectId: string,
  projectDraft: ProjectDraft,
  sessionsByRecord: ReadonlyMap<string, WorkspaceTreeSession<A>[]>,
): ShellProjectRow<A> {
  const rows = [...projectDraft.worktrees.values()].map((draft) =>
    buildWorktreeRow(draft, sessionsByRecord),
  );
  rows.sort(compareTreeNodes);
  let activeCount = 0;
  let needsInputCount = 0;
  let lastUsedAt: number | null = null;
  for (const row of rows) {
    activeCount += row.activeCount;
    needsInputCount += row.needsInputCount;
    if (row.lastUsedAt !== null && (lastUsedAt === null || row.lastUsedAt > lastUsedAt)) {
      lastUsedAt = row.lastUsedAt;
    }
  }
  return {
    key: `${serverId}:${projectId}`,
    serverId,
    projectId,
    name: projectDraft.name,
    activeCount,
    needsInputCount,
    lastUsedAt,
    worktrees: rows,
  };
}

export function buildWorkspaceTree<A extends WorkspaceTreeAgent>(
  input: BuildWorkspaceTreeInput<A>,
): ShellHostSection<A>[] {
  const agentStats = indexAgents(input.agents);
  const sessionsByRecord = indexSessions(input.agents);

  // host → project → worktree drafts. The seen guard keeps a record that somehow
  // appears under two project entries from being counted twice.
  const draftsByHost = new Map<string, Map<string, ProjectDraft>>();
  for (const host of input.hosts) draftsByHost.set(host.serverId, new Map());

  const seen = new Set<string>();
  for (const project of input.projects) {
    for (const entry of project.hosts) {
      const projects = draftsByHost.get(entry.serverId);
      if (!projects) continue;
      let projectDraft = projects.get(entry.projectId);
      if (!projectDraft) {
        projectDraft = {
          name: displayName(entry.projectCustomName, entry.projectName),
          worktrees: new Map(),
        };
        projects.set(entry.projectId, projectDraft);
      }
      for (const workspace of entry.workspaces) {
        const recordKey = `${entry.serverId}:${workspace.id}`;
        if (seen.has(recordKey)) continue;
        seen.add(recordKey);
        const cwd = normalizeWorkspacePath(input.workspacePaths.get(recordKey) ?? "") ?? "";
        mergeRecordIntoDraft(
          projectDraft.worktrees,
          entry.serverId,
          entry.projectId,
          workspace,
          cwd,
          agentStats.get(recordKey),
        );
      }
    }
  }

  const sections = input.hosts.map<ShellHostSection<A>>((host) => {
    const status = input.statuses.get(host.serverId) ?? "connecting";
    const projectDrafts = draftsByHost.get(host.serverId) ?? new Map();
    const projectsOut: ShellProjectRow<A>[] = [];
    for (const [projectId, projectDraft] of projectDrafts) {
      // 项目无 worktree → 隐藏 L1（数据上不会出现，防御性保留）。
      if (projectDraft.worktrees.size === 0) continue;
      projectsOut.push(buildProjectRow(host.serverId, projectId, projectDraft, sessionsByRecord));
    }
    projectsOut.sort(compareTreeNodes);
    return {
      serverId: host.serverId,
      label: host.label,
      status,
      isOnline: status === "online",
      projects: projectsOut,
    };
  });
  // Online hosts first; registration order preserved inside each bucket.
  return sections.sort((left, right) => Number(right.isOnline) - Number(left.isOnline));
}
