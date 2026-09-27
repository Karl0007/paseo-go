// R2-21 (口径裁定): 概览 M 项目 = the 工作区 tree's L1 row count — the SAME
// buildWorkspaceTree the tab renders, so the two screens can never disagree.
// A project carried by two hosts is two L1 rows → counts 2 (the old
// projects.length read 1). R2-06 stands: 活跃 = the official bucket's live set.
// R2-08①: 壳归档 agents leave 活跃 (the archive store the tree now also honors).
import { describe, expect, it } from "vitest";
import type { ProjectHostEntry, ProjectSummary, WorkspaceSummary } from "@/utils/projects";
import type { WorkspaceTreeAgent } from "@/shell/workspace/derive";
import { buildShellOverview } from "@/shell/overview";

function workspace(id: string): WorkspaceSummary {
  return {
    id,
    name: id,
    workspaceKind: "directory",
    status: "done",
    currentBranch: null,
    changeRequestNumber: null,
  };
}

function hostEntry(
  serverId: string,
  projectName: string,
  workspaces: WorkspaceSummary[],
): ProjectHostEntry {
  return {
    serverId,
    projectId: `proj-${serverId}-${projectName}`,
    projectName,
    projectCustomName: null,
    serverName: serverId,
    isOnline: true,
    repoRoot: `/repo/${projectName}`,
    workspaceCount: workspaces.length,
    workspaces,
  };
}

function project(viewKey: string, hosts: ProjectHostEntry[]): ProjectSummary {
  return {
    viewKey,
    projectName: hosts[0]?.projectName ?? viewKey,
    hosts,
    totalWorkspaceCount: hosts.reduce((n, h) => n + h.workspaces.length, 0),
    hostCount: hosts.length,
    onlineHostCount: hosts.filter((h) => h.isOnline).length,
  };
}

function agent(patch: Partial<WorkspaceTreeAgent> = {}): WorkspaceTreeAgent {
  return {
    serverId: "srv-A",
    id: "ag-1",
    workspaceId: "ws-1",
    status: "running",
    lastActivityAt: new Date("2026-09-25T06:00:00Z"),
    ...patch,
  };
}

const HOSTS = [
  { serverId: "srv-A", label: "A" },
  { serverId: "srv-B", label: "B" },
];

// 跨主机同项目 (v-shared, 2 L1 rows) + 单机项目 (v-solo, 1 row) = 3.
const PROJECTS = [
  project("v-shared", [
    hostEntry("srv-A", "paseo", [workspace("ws-a1")]),
    hostEntry("srv-B", "paseo", [workspace("ws-b1")]),
  ]),
  project("v-solo", [hostEntry("srv-A", "solo", [workspace("ws-a2")])]),
];

describe("buildShellOverview", () => {
  it("counts hosts, tree-L1 projects and the official bucket's live set", () => {
    const counts = buildShellOverview({
      hosts: HOSTS,
      projects: PROJECTS,
      agents: [
        agent(),
        agent({ id: "ag-init", status: "initializing" }),
        agent({
          id: "ag-needs",
          status: "idle",
          requiresAttention: true,
          attentionReason: "permission",
        }),
        agent({ id: "ag-idle", status: "idle" }),
        agent({ id: "ag-closed", status: "closed" }),
        agent({
          id: "ag-done-attn",
          status: "running",
          requiresAttention: true,
          attentionReason: "finished",
        }),
      ],
      archivedIds: [],
    });
    // R2-06: initializing is bucket-done (the row light is grey) — never counted;
    // finished-attention on a running agent stays one live agent.
    expect(counts).toEqual({ hostCount: 2, projectCount: 3, activeAgentCount: 3 });
  });

  it("R2-21: one project on two hosts counts 2 — the tree shows two L1 rows", () => {
    const counts = buildShellOverview({
      hosts: HOSTS,
      projects: [
        project("v-shared", [
          hostEntry("srv-A", "paseo", [workspace("ws-a1")]),
          hostEntry("srv-B", "paseo", [workspace("ws-b1")]),
        ]),
      ],
      agents: [],
      archivedIds: [],
    });
    expect(counts.projectCount).toBe(2);
  });

  it("projects on hosts the shell does not carry never count", () => {
    const counts = buildShellOverview({
      hosts: HOSTS,
      projects: [
        project("v-ghost", [hostEntry("srv-Z", "unregistered", [workspace("ws-z")])]),
        ...PROJECTS,
      ],
      agents: [],
      archivedIds: [],
    });
    expect(counts.projectCount).toBe(3);
  });

  it("R2-08①: 壳归档 agents leave 活跃 without touching the project rows", () => {
    const live = buildShellOverview({
      hosts: HOSTS,
      projects: PROJECTS,
      agents: [agent(), agent({ id: "ag-arch", status: "running" })],
      archivedIds: [],
    });
    const archived = buildShellOverview({
      hosts: HOSTS,
      projects: PROJECTS,
      agents: [agent(), agent({ id: "ag-arch", status: "running" })],
      archivedIds: ["srv-A:ag-arch"],
    });
    expect(live.activeAgentCount).toBe(2);
    expect(archived.activeAgentCount).toBe(1);
    expect(archived.projectCount).toBe(live.projectCount);
  });

  it("is zero-safe on cold subscriptions", () => {
    expect(buildShellOverview({ hosts: [], projects: [], agents: [], archivedIds: [] })).toEqual({
      hostCount: 0,
      projectCount: 0,
      activeAgentCount: 0,
    });
  });

  it("R2-06: a count-only permission request counts as active (official needs_input)", () => {
    const counts = buildShellOverview({
      hosts: [],
      projects: [],
      agents: [agent({ status: "idle", pendingPermissionCount: 2 })],
      archivedIds: [],
    });
    expect(counts.activeAgentCount).toBe(1);
  });
});
