// 概览卡 counts (DESIGN §6, card C8): `N 主机 · M 项目 · K 活跃 agent`, derived
// from the same subscriptions the workspace tab feeds (useHosts / useProjects /
// useAggregatedAgents) — no new RPC. 活跃 reuses the workspace badge's definition
// (derive.ts), so the two screens can never disagree on what "active" means.
import { isWorkspaceAgentActive, type WorkspaceTreeAgent } from "@/shell/workspace/derive";

export interface ShellOverviewCounts {
  hostCount: number;
  projectCount: number;
  activeAgentCount: number;
}

export interface ShellOverviewInput {
  hosts: readonly { serverId: string }[];
  projects: readonly unknown[];
  agents: readonly WorkspaceTreeAgent[];
}

export function buildShellOverview({
  hosts,
  projects,
  agents,
}: ShellOverviewInput): ShellOverviewCounts {
  return {
    hostCount: hosts.length,
    projectCount: projects.length,
    activeAgentCount: agents.filter(isWorkspaceAgentActive).length,
  };
}
