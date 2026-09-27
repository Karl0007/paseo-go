// 概览卡 counts (DESIGN §6, card C8): `N 主机 · M 项目 · K 活跃 agent`, derived
// from the same subscriptions the workspace tab feeds (useHosts / useProjects /
// useAggregatedAgents) — no new RPC. 活跃 reuses the workspace badge's definition
// (derive.ts), so the two screens can never disagree on what "active" means.
// R2-21 (口径裁定): M 项目 = the tree's L1 row count, not projects.length — the
// 工作区 tab lists one row per (host, project), and the card must say the same.
// R2-08①: 壳归档 rows leave 活跃 exactly like the tree's badges do.
import type { ProjectSummary } from "@/utils/projects";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import {
  buildWorkspaceTree,
  isWorkspaceAgentActive,
  type WorkspaceTreeAgent,
  type WorkspaceTreeHost,
} from "@/shell/workspace/derive";

export interface ShellOverviewCounts {
  hostCount: number;
  projectCount: number;
  activeAgentCount: number;
}

export interface ShellOverviewInput {
  hosts: readonly WorkspaceTreeHost[];
  projects: readonly ProjectSummary[];
  agents: readonly WorkspaceTreeAgent[];
  /** 壳归档 row keys (`${serverId}:${agentId}`, the archive store). */
  archivedIds: readonly string[];
}

// The two tree inputs the 概览 card does not subscribe to. Both are provably
// irrelevant to the L1 count: statuses only order/flag the host sections and
// workspacePaths only merge L2 rows — an L1 row exists per (host, projectId)
// carrying ≥1 workspace record either way. Empty constants, never per-call
// allocations.
const NO_STATUSES = new Map<string, HostRuntimeConnectionStatus>();
const NO_PATHS = new Map<string, string>();

export function buildShellOverview({
  hosts,
  projects,
  agents,
  archivedIds,
}: ShellOverviewInput): ShellOverviewCounts {
  const archived = new Set(archivedIds);
  const liveAgents = agents.filter((agent) => !archived.has(`${agent.serverId}:${agent.id}`));
  // 单一真相: the count IS the tab's row count — one buildWorkspaceTree call,
  // summed L1 rows (跨主机同项目 = 2 rows = 2).
  const sections = buildWorkspaceTree({
    hosts,
    statuses: NO_STATUSES,
    projects,
    agents: liveAgents,
    workspacePaths: NO_PATHS,
    archivedIds,
  });
  let projectCount = 0;
  for (const section of sections) projectCount += section.projects.length;
  return {
    hostCount: hosts.length,
    projectCount,
    activeAgentCount: liveAgents.filter(isWorkspaceAgentActive).length,
  };
}
