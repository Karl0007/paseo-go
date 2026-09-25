// C5 acceptance item 2: the host→workspace tree derivation — badge counting,
// 最近使用 ordering, multi-host grouping, offline placement, empty workspaces.
import { describe, expect, it } from "vitest";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { ProjectHostEntry, ProjectSummary, WorkspaceSummary } from "@/utils/projects";
import { buildWorkspaceTree, isWorkspaceAgentActive, type WorkspaceTreeAgent } from "./derive";

function workspace(id: string, name: string, title?: string | null): WorkspaceSummary {
  return {
    id,
    name,
    title: title ?? undefined,
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
  overrides: Partial<ProjectHostEntry> = {},
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
    ...overrides,
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

function agent(overrides: Partial<WorkspaceTreeAgent> & { serverId: string }): WorkspaceTreeAgent {
  return {
    workspaceId: "ws-1",
    status: "idle",
    lastActivityAt: new Date("2026-09-25T10:00:00Z"),
    ...overrides,
  };
}

const HOSTS = [
  { serverId: "host-a", label: "LAPTOP-A" },
  { serverId: "host-b", label: "PAD-B" },
];

function statuses(entries: Array<[string, HostRuntimeConnectionStatus]>) {
  return new Map(entries);
}

describe("isWorkspaceAgentActive", () => {
  it("counts running/initializing as active", () => {
    expect(isWorkspaceAgentActive(agent({ serverId: "h", status: "running" }))).toBe(true);
    expect(isWorkspaceAgentActive(agent({ serverId: "h", status: "initializing" }))).toBe(true);
  });

  it("counts permission-waiting attention as active, finished/error attention as not", () => {
    expect(
      isWorkspaceAgentActive(
        agent({
          serverId: "h",
          status: "idle",
          requiresAttention: true,
          attentionReason: "permission",
        }),
      ),
    ).toBe(true);
    expect(
      isWorkspaceAgentActive(
        agent({
          serverId: "h",
          status: "idle",
          requiresAttention: true,
          attentionReason: "finished",
        }),
      ),
    ).toBe(false);
    expect(isWorkspaceAgentActive(agent({ serverId: "h", status: "error" }))).toBe(false);
    expect(isWorkspaceAgentActive(agent({ serverId: "h", status: "closed" }))).toBe(false);
  });
});

describe("buildWorkspaceTree", () => {
  it("groups workspaces under their host with per-workspace badge counts", () => {
    const sections = buildWorkspaceTree({
      hosts: HOSTS,
      statuses: statuses([
        ["host-a", "online"],
        ["host-b", "online"],
      ]),
      projects: [
        project("p1", [hostEntry("host-a", "paseo", [workspace("ws-a1", "paseo")])]),
        project("p2", [hostEntry("host-b", "blog", [workspace("ws-b1", "blog")])]),
      ],
      agents: [
        agent({ serverId: "host-a", workspaceId: "ws-a1", status: "running" }),
        agent({ serverId: "host-a", workspaceId: "ws-a1", status: "idle" }),
        agent({ serverId: "host-b", workspaceId: "ws-b1", status: "error" }),
      ],
    });
    expect(sections.map((s) => s.serverId)).toEqual(["host-a", "host-b"]);
    expect(sections[0]?.rows.map((r) => [r.workspaceId, r.activeCount, r.projectName])).toEqual([
      ["ws-a1", 1, "paseo"],
    ]);
    expect(sections[1]?.rows[0]?.activeCount).toBe(0);
  });

  it("sorts rows by newest agent activity, agent-less workspaces last and alphabetical there", () => {
    const sections = buildWorkspaceTree({
      hosts: [HOSTS[0]!],
      statuses: statuses([["host-a", "online"]]),
      projects: [
        project("p1", [
          hostEntry("host-a", "mono", [
            workspace("ws-old", "old"),
            workspace("ws-new", "new"),
            workspace("ws-zeta", "zeta"),
            workspace("ws-alpha", "alpha"),
          ]),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          workspaceId: "ws-old",
          lastActivityAt: new Date("2026-09-24T00:00:00Z"),
        }),
        agent({
          serverId: "host-a",
          workspaceId: "ws-new",
          lastActivityAt: new Date("2026-09-25T09:00:00Z"),
        }),
      ],
    });
    expect(sections[0]?.rows.map((r) => r.workspaceId)).toEqual([
      "ws-new",
      "ws-old",
      "ws-alpha",
      "ws-zeta",
    ]);
    expect(sections[0]?.rows.map((r) => r.lastUsedAt !== null)).toEqual([true, true, false, false]);
  });

  it("prefers workspace/project custom titles over raw names", () => {
    const sections = buildWorkspaceTree({
      hosts: [HOSTS[0]!],
      statuses: statuses([["host-a", "online"]]),
      projects: [
        project("p1", [
          hostEntry("host-a", "paseo", [workspace("ws-1", "worktree-slug", " 主分支 ")], {
            projectCustomName: "Paseo 主仓",
          }),
        ]),
      ],
      agents: [],
    });
    expect(sections[0]?.rows[0]).toMatchObject({
      name: "主分支",
      projectName: "Paseo 主仓",
    });
  });

  it("keeps offline hosts in the tree, greyed via isOnline=false, sorted after online hosts", () => {
    const sections = buildWorkspaceTree({
      hosts: HOSTS,
      statuses: statuses([
        ["host-a", "offline"],
        ["host-b", "online"],
      ]),
      projects: [
        project("p1", [hostEntry("host-a", "paseo", [workspace("ws-a1", "paseo")])]),
        project("p2", [hostEntry("host-b", "blog", [workspace("ws-b1", "blog")])]),
      ],
      agents: [],
    });
    expect(sections.map((s) => [s.serverId, s.isOnline, s.status])).toEqual([
      ["host-b", true, "online"],
      ["host-a", false, "offline"],
    ]);
    // The offline host still shows its last-known rows (cached replica).
    expect(sections[1]?.rows.map((r) => r.workspaceId)).toEqual(["ws-a1"]);
  });

  it("emits empty sections for hosts without projects and unknown statuses as connecting", () => {
    const sections = buildWorkspaceTree({
      hosts: [{ serverId: "host-c", label: "NEW-C" }],
      statuses: new Map(),
      projects: [],
      agents: [],
    });
    expect(sections).toEqual([
      { serverId: "host-c", label: "NEW-C", status: "connecting", isOnline: false, rows: [] },
    ]);
  });

  it("ignores agents without a workspace and never double-counts a shared project row", () => {
    const shared = hostEntry("host-a", "paseo", [workspace("ws-a1", "paseo")]);
    const sections = buildWorkspaceTree({
      hosts: [HOSTS[0]!],
      statuses: statuses([["host-a", "online"]]),
      projects: [
        project("p1", [shared]),
        project("p1-dup", [shared]), // same view re-surfaced: row must appear once
      ],
      agents: [agent({ serverId: "host-a", workspaceId: undefined, status: "running" })],
    });
    expect(sections[0]?.rows).toHaveLength(1);
    expect(sections[0]?.rows[0]?.activeCount).toBe(0);
  });
});
