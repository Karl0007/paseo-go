// 工作区 tab tree derivation (DESIGN §5, card C5): pure regrouping of the official
// useProjects() output (project → host entries) into the shell's host → workspace
// sections, plus the per-workspace active-agent badge and the 最近使用 sort. No
// React, no stores — the screen feeds it hook output; the unit tests feed fixtures.
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { ProjectSummary } from "@/utils/projects";

export interface WorkspaceTreeHost {
  serverId: string;
  label: string;
}

// Structural subset of AggregatedAgent the badge/recency maths needs.
export interface WorkspaceTreeAgent {
  serverId: string;
  workspaceId?: string;
  status: AgentLifecycleStatus;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  lastActivityAt: Date;
}

export interface ShellWorkspaceRow {
  /** `${serverId}:${workspaceId}` — list key and files-route identity. */
  key: string;
  serverId: string;
  workspaceId: string;
  /** Workspace display name (title falls back to name). */
  name: string;
  /** Owning project display name (custom name falls back to name). */
  projectName: string;
  /** 活跃 agent 数角标: running/initializing agents plus permission-waiting ones. */
  activeCount: number;
  /** Newest agent activity on the workspace; null when no agent ever ran. */
  lastUsedAt: number | null;
}

export interface ShellHostSection {
  serverId: string;
  label: string;
  status: HostRuntimeConnectionStatus;
  isOnline: boolean;
  rows: ShellWorkspaceRow[];
}

export interface BuildWorkspaceTreeInput {
  hosts: readonly WorkspaceTreeHost[];
  statuses: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  projects: readonly ProjectSummary[];
  agents: readonly WorkspaceTreeAgent[];
}

// 活跃 = the agent is doing something right now: running, still initializing, or
// parked on a permission request. finished/error attention and idle/closed agents
// are history, not activity — the badge mirrors the 对话 tab's live lights, not the
// workspace's total session count.
export function isWorkspaceAgentActive(agent: WorkspaceTreeAgent): boolean {
  if (agent.status === "running" || agent.status === "initializing") return true;
  return agent.requiresAttention === true && agent.attentionReason === "permission";
}

interface WorkspaceAgentStats {
  activeCount: number;
  lastUsedAt: number | null;
}

function indexAgents(agents: readonly WorkspaceTreeAgent[]): Map<string, WorkspaceAgentStats> {
  const stats = new Map<string, WorkspaceAgentStats>();
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    const key = `${agent.serverId}:${agent.workspaceId}`;
    const entry = stats.get(key);
    if (!entry) {
      stats.set(key, {
        activeCount: isWorkspaceAgentActive(agent) ? 1 : 0,
        lastUsedAt: agent.lastActivityAt.getTime(),
      });
      continue;
    }
    if (isWorkspaceAgentActive(agent)) entry.activeCount += 1;
    const at = agent.lastActivityAt.getTime();
    if (entry.lastUsedAt === null || at > entry.lastUsedAt) entry.lastUsedAt = at;
  }
  return stats;
}

function displayName(title: string | null | undefined, fallback: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : fallback;
}

// 最近使用: newest agent activity first; workspaces that never ran an agent sink
// to the bottom, alphabetical there (and on ties) so the order is stable.
function compareRows(left: ShellWorkspaceRow, right: ShellWorkspaceRow): number {
  if (left.lastUsedAt !== null || right.lastUsedAt !== null) {
    if (left.lastUsedAt === null) return 1;
    if (right.lastUsedAt === null) return -1;
    if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
  }
  return left.name.localeCompare(right.name);
}

export function buildWorkspaceTree(input: BuildWorkspaceTreeInput): ShellHostSection[] {
  const agentStats = indexAgents(input.agents);
  const rowsByHost = new Map<string, ShellWorkspaceRow[]>();
  for (const host of input.hosts) rowsByHost.set(host.serverId, []);

  const seen = new Set<string>();
  for (const project of input.projects) {
    for (const entry of project.hosts) {
      const rows = rowsByHost.get(entry.serverId);
      if (!rows) continue;
      const projectName = displayName(entry.projectCustomName, entry.projectName);
      for (const workspace of entry.workspaces) {
        const key = `${entry.serverId}:${workspace.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const stats = agentStats.get(key);
        rows.push({
          key,
          serverId: entry.serverId,
          workspaceId: workspace.id,
          name: displayName(workspace.title, workspace.name),
          projectName,
          activeCount: stats?.activeCount ?? 0,
          lastUsedAt: stats?.lastUsedAt ?? null,
        });
      }
    }
  }

  const sections = input.hosts.map((host) => {
    const status = input.statuses.get(host.serverId) ?? "connecting";
    return {
      serverId: host.serverId,
      label: host.label,
      status,
      isOnline: status === "online",
      rows: rowsByHost.get(host.serverId)?.slice().sort(compareRows) ?? [],
    };
  });
  // Online hosts first; registration order preserved inside each bucket.
  return sections.sort((left, right) => Number(right.isOnline) - Number(left.isOnline));
}
