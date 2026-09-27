// C26 acceptance item 2: the host → L1 工程 → L2 worktree → L3 session derivation —
// physical merge (normalized cwd + branch), representative-record election, aggregated
// badges (needs_input 优先), stable hierarchical ordering, 无会话 worktrees, empty
// states, offline placement. Pure fixtures; the screen feeds the same function live.
import { describe, expect, it } from "vitest";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { ProjectHostEntry, ProjectSummary, WorkspaceSummary } from "@/utils/projects";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import {
  badgeTone,
  buildWorkspaceTree,
  isWorkspaceAgentActive,
  isWorkspaceAgentNeedsInput,
  pathTail,
  workspaceAgentLastEventAt,
  type BuildWorkspaceTreeInput,
  type ShellHostSection,
  type WorkspaceTreeAgent,
} from "./derive";

function workspace(
  id: string,
  name: string,
  overrides: Partial<WorkspaceSummary> = {},
): WorkspaceSummary {
  return {
    id,
    name,
    workspaceKind: "directory",
    status: "done",
    currentBranch: null,
    changeRequestNumber: null,
    ...overrides,
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

function agent(
  overrides: Partial<WorkspaceTreeAgent> & { serverId: string; id: string },
): WorkspaceTreeAgent {
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

const ONLINE = new Map<string, HostRuntimeConnectionStatus>([
  ["host-a", "online"],
  ["host-b", "online"],
]);

function build(overrides: Partial<BuildWorkspaceTreeInput> = {}): ShellHostSection[] {
  return buildWorkspaceTree({
    hosts: HOSTS,
    statuses: ONLINE,
    projects: [],
    agents: [],
    workspacePaths: new Map(),
    archivedIds: [],
    ...overrides,
  });
}

function section(sections: ShellHostSection[], serverId: string): ShellHostSection {
  const found = sections.find((entry) => entry.serverId === serverId);
  if (!found) throw new Error(`missing section ${serverId}`);
  return found;
}

describe("isWorkspaceAgentActive", () => {
  it("active is the official bucket's live set: running/needs_input — initializing is done", () => {
    // R2-06 (FIX-A): the badge must be the same source as the 对话-tab light
    // (deriveAgentStateBucket). The official bucket files `initializing` under
    // done (nothing is running yet); counting it here made the workspace badge
    // light up rows whose own status dot is grey.
    expect(isWorkspaceAgentActive(agent({ serverId: "h", id: "a", status: "running" }))).toBe(true);
    expect(isWorkspaceAgentActive(agent({ serverId: "h", id: "a", status: "initializing" }))).toBe(
      false,
    );
    expect(isWorkspaceAgentActive(agent({ serverId: "h", id: "a", status: "idle" }))).toBe(false);
    expect(isWorkspaceAgentActive(agent({ serverId: "h", id: "a", status: "closed" }))).toBe(false);
  });

  it("counts permission-waiting attention as active, finished/error attention as not", () => {
    expect(
      isWorkspaceAgentActive(
        agent({
          serverId: "h",
          id: "a",
          status: "idle",
          requiresAttention: true,
          attentionReason: "permission",
        }),
      ),
    ).toBe(true);
    for (const reason of ["finished", "error"] as const) {
      expect(
        isWorkspaceAgentActive(
          agent({
            serverId: "h",
            id: "a",
            status: "idle",
            requiresAttention: true,
            attentionReason: reason,
          }),
        ),
      ).toBe(false);
    }
  });

  // R2-06: the official needs_input edge is `pendingPermissionCount > 0 ∨
  // attentionReason === "permission"` — the count-only shape (permission
  // pends, no attention flag yet) was missed by the hand-rolled enumeration.
  it("count-only permission requests are active AND needs_input", () => {
    const counted = agent({ serverId: "h", id: "a", status: "idle", pendingPermissionCount: 2 });
    expect(isWorkspaceAgentNeedsInput(counted)).toBe(true);
    expect(isWorkspaceAgentActive(counted)).toBe(true);
    // Belt: the attention-flag shape keeps working (both edges, one bucket).
    const flagged = agent({
      serverId: "h",
      id: "b",
      status: "idle",
      requiresAttention: true,
      attentionReason: "permission",
    });
    expect(isWorkspaceAgentNeedsInput(flagged)).toBe(true);
    expect(isWorkspaceAgentActive(flagged)).toBe(true);
  });
});

describe("isWorkspaceAgentNeedsInput / workspaceAgentLastEventAt", () => {
  it("needs_input is exactly the permission-waiting subset of 活跃", () => {
    const waiting = agent({
      serverId: "h",
      id: "a",
      status: "idle",
      requiresAttention: true,
      attentionReason: "permission",
    });
    const running = agent({ serverId: "h", id: "b", status: "running" });
    const finished = agent({
      serverId: "h",
      id: "c",
      status: "idle",
      requiresAttention: true,
      attentionReason: "finished",
    });
    expect(isWorkspaceAgentNeedsInput(waiting)).toBe(true);
    expect(isWorkspaceAgentNeedsInput(running)).toBe(false);
    expect(isWorkspaceAgentNeedsInput(finished)).toBe(false);
  });

  it("last event is activity or the newer attention stamp", () => {
    expect(
      workspaceAgentLastEventAt(
        agent({
          serverId: "h",
          id: "a",
          lastActivityAt: new Date(1_000),
          attentionTimestamp: new Date(2_500),
        }),
      ),
    ).toBe(2_500);
    expect(
      workspaceAgentLastEventAt(
        agent({
          serverId: "h",
          id: "a",
          lastActivityAt: new Date(3_000),
          attentionTimestamp: new Date(2_000),
        }),
      ),
    ).toBe(3_000);
    expect(
      workspaceAgentLastEventAt(agent({ serverId: "h", id: "a", lastActivityAt: new Date(9) })),
    ).toBe(9);
  });
});

describe("badgeTone", () => {
  it("needs_input outranks running; zero renders nothing", () => {
    expect(badgeTone(3, 1)).toBe("needs");
    expect(badgeTone(3, 0)).toBe("active");
    expect(badgeTone(0, 0)).toBeNull();
  });
});

describe("pathTail", () => {
  it("takes the last segment of the normalized path", () => {
    expect(pathTail("/home/dev/paseo-go")).toBe("paseo-go");
    expect(pathTail("C:/work/paseo-go")).toBe("paseo-go");
    expect(pathTail("paseo-go")).toBe("paseo-go");
    expect(pathTail("/")).toBe("/");
    expect(pathTail("")).toBe("");
    expect(pathTail("  ")).toBe("");
  });
});

describe("buildWorkspaceTree — hierarchy shape", () => {
  it("nests host → project → worktree → session with the display-name fallbacks", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [workspace("ws-1", "feat-x", { title: "长摘要标题" })], {
            projectCustomName: "Paseo 工程",
          }),
        ]),
      ],
      agents: [agent({ serverId: "host-a", id: "ag-1", workspaceId: "ws-1" })],
      workspacePaths: new Map([["host-a:ws-1", "/repo/paseo"]]),
    });
    const l1 = section(sections, "host-a").projects[0];
    expect(l1.name).toBe("Paseo 工程");
    expect(l1.key).toBe("host-a:proj-host-a-paseo");
    const l2 = l1.worktrees[0];
    // title ‖ name: the 摘要 lives at L2, not on the project row.
    expect(l2.name).toBe("长摘要标题");
    expect(l2.cwd).toBe("/repo/paseo");
    const l3 = l2.sessions[0];
    expect(l3.key).toBe("host-a:ag-1");
    expect(l3.agent.id).toBe("ag-1");
  });

  it("falls back to projectName / workspace name when titles are blank", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [workspace("ws-1", "main", { title: "   " })], {
            projectCustomName: "  ",
          }),
        ]),
      ],
    });
    const l1 = section(sections, "host-a").projects[0];
    expect(l1.name).toBe("paseo");
    expect(l1.worktrees[0].name).toBe("main");
  });

  it("empty hosts carry no projects; a project without workspaces carries no L1", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [])])],
    });
    expect(section(sections, "host-a").projects).toEqual([]);
  });
});

describe("buildWorkspaceTree — 物理合并 (cwd + branch)", () => {
  it("merges same-directory same-branch records into one L2, unioning ids and sessions", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-old", "rec-old", { title: "旧摘要", currentBranch: "main" }),
            workspace("ws-new", "rec-new", { title: "新摘要", currentBranch: "main" }),
            // Separator/trailing-slash variants of the same cwd merge (preview-root
            // posture: unify separators, keep case).
            workspace("ws-slash", "rec-slash", { currentBranch: "main" }),
          ]),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          id: "ag-old",
          workspaceId: "ws-old",
          lastActivityAt: new Date(1_000),
        }),
        agent({
          serverId: "host-a",
          id: "ag-new",
          workspaceId: "ws-new",
          lastActivityAt: new Date(2_000),
        }),
        agent({
          serverId: "host-a",
          id: "ag-slash",
          workspaceId: "ws-slash",
          lastActivityAt: new Date(3_000),
        }),
      ],
      workspacePaths: new Map([
        ["host-a:ws-old", "/repo/paseo"],
        ["host-a:ws-new", "/repo/paseo/"],
        ["host-a:ws-slash", "\\repo\\paseo\\"],
      ]),
    });
    const l1 = section(sections, "host-a").projects[0];
    expect(l1.worktrees).toHaveLength(1);
    const l2 = l1.worktrees[0];
    expect(l2.workspaceIds).toEqual(["ws-old", "ws-new", "ws-slash"]);
    // 代表记录 = 最新 activity → ws-slash; its name is title ‖ name.
    expect(l2.workspaceId).toBe("ws-slash");
    expect(l2.name).toBe("rec-slash");
    expect(l2.cwd).toBe("/repo/paseo");
    expect(l2.sessions.map((s) => s.agentId)).toEqual(["ag-slash", "ag-new", "ag-old"]);
    expect(l2.lastUsedAt).toBe(3_000);
  });

  it("keeps the newest-activity representative even when an older record arrives last", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-1", "one", { title: "活跃摘要", currentBranch: "main" }),
            workspace("ws-2", "two", { currentBranch: "main" }),
          ]),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          id: "ag-1",
          workspaceId: "ws-1",
          lastActivityAt: new Date(5_000),
        }),
        agent({
          serverId: "host-a",
          id: "ag-2",
          workspaceId: "ws-2",
          lastActivityAt: new Date(1_000),
        }),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "/repo/x"],
        ["host-a:ws-2", "/repo/x"],
      ]),
    });
    const l2 = section(sections, "host-a").projects[0].worktrees[0];
    expect(l2.workspaceId).toBe("ws-1");
    expect(l2.name).toBe("活跃摘要");
  });

  it("case is preserved: /Repo/x and /repo/x are different physical directories", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-1", "upper", { currentBranch: "main" }),
            workspace("ws-2", "lower", { currentBranch: "main" }),
          ]),
        ]),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "/Repo/x"],
        ["host-a:ws-2", "/repo/x"],
      ]),
    });
    expect(section(sections, "host-a").projects[0].worktrees).toHaveLength(2);
  });

  it("branch is an identity axis: same cwd on two branches stays two rows", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-1", "on-main", { currentBranch: "main" }),
            workspace("ws-2", "on-dev", { currentBranch: "dev" }),
          ]),
        ]),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "/repo/x"],
        ["host-a:ws-2", "/repo/x"],
      ]),
    });
    expect(section(sections, "host-a").projects[0].worktrees).toHaveLength(2);
  });

  it("cwd-less records never merge into each other", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [workspace("ws-1", "one"), workspace("ws-2", "two")]),
        ]),
      ],
    });
    const worktrees = section(sections, "host-a").projects[0].worktrees;
    expect(worktrees).toHaveLength(2);
    expect(worktrees.every((row) => row.cwd === "")).toBe(true);
  });

  it("merges across duplicate project summaries sharing a projectId; a record counts once", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [workspace("ws-1", "one", { currentBranch: "main" })]),
        ]),
        project("v2", [
          hostEntry("host-a", "paseo", [workspace("ws-2", "two", { currentBranch: "main" })]),
        ]),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "/repo/x"],
        ["host-a:ws-2", "/repo/x"],
      ]),
    });
    const projects = section(sections, "host-a").projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].worktrees).toHaveLength(1);
    expect(projects[0].worktrees[0].workspaceIds).toEqual(["ws-1", "ws-2"]);
  });
});

describe("buildWorkspaceTree — 角标聚合", () => {
  it("L2 sums agents over merged records; L1 aggregates its L2s", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-1", "a", { currentBranch: "main" }),
            workspace("ws-2", "b", { currentBranch: "dev" }),
          ]),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          id: "r1",
          workspaceId: "ws-1",
          status: "running",
        }),
        agent({
          serverId: "host-a",
          id: "p1",
          workspaceId: "ws-1",
          requiresAttention: true,
          attentionReason: "permission",
        }),
        agent({ serverId: "host-a", id: "f1", workspaceId: "ws-1" }),
        agent({
          serverId: "host-a",
          id: "r2",
          workspaceId: "ws-2",
          status: "running",
        }),
        // Unknown workspace: contributes nothing, spawns nothing.
        agent({
          serverId: "host-a",
          id: "ghost",
          workspaceId: "ws-404",
          status: "running",
        }),
        // No workspaceId: ignored entirely.
        agent({ serverId: "host-a", id: "orphan", workspaceId: undefined, status: "running" }),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "/repo/x"],
        ["host-a:ws-2", "/repo/y"],
      ]),
    });
    const l1 = section(sections, "host-a").projects[0];
    const [l2a, l2b] = l1.worktrees;
    expect(l2a.workspaceId).toBe("ws-1");
    expect(l2a.activeCount).toBe(2); // running + permission-waiting
    expect(l2a.needsInputCount).toBe(1);
    expect(l2b.activeCount).toBe(1);
    expect(l2b.needsInputCount).toBe(0);
    expect(l1.activeCount).toBe(3);
    expect(l1.needsInputCount).toBe(1);
    expect(badgeTone(l1.activeCount, l1.needsInputCount)).toBe("needs");
    expect(badgeTone(l2b.activeCount, l2b.needsInputCount)).toBe("active");
  });

  it("finished/error attention never enters the badge", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])])],
      agents: [
        agent({
          serverId: "host-a",
          id: "done1",
          workspaceId: "ws-1",
          requiresAttention: true,
          attentionReason: "finished",
        }),
        agent({
          serverId: "host-a",
          id: "err1",
          workspaceId: "ws-1",
          status: "error",
          requiresAttention: true,
          attentionReason: "error",
        }),
      ],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
    });
    const l1 = section(sections, "host-a").projects[0];
    expect(l1.worktrees[0].sessions).toHaveLength(2);
    expect(l1.activeCount).toBe(0);
    expect(badgeTone(l1.activeCount, l1.needsInputCount)).toBeNull();
  });

  it("R2-06 buckets: initializing sinks out of the badge, count-only permission enters as needs", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])])],
      agents: [
        agent({ serverId: "host-a", id: "init1", workspaceId: "ws-1", status: "initializing" }),
        agent({ serverId: "host-a", id: "cnt1", workspaceId: "ws-1", pendingPermissionCount: 1 }),
      ],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
    });
    const l1 = section(sections, "host-a").projects[0];
    expect(l1.activeCount).toBe(1); // only the count-only needs_input row
    expect(l1.needsInputCount).toBe(1);
    expect(badgeTone(l1.activeCount, l1.needsInputCount)).toBe("needs");
  });
});

describe("buildWorkspaceTree — 层级排序", () => {
  it("L2 sorts 活跃 → lastUsedAt → 字典序, never-used sinking", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry(
            "host-a",
            "paseo",
            [
              workspace("ws-live", "zeta", { currentBranch: "b1" }),
              workspace("ws-cold", "alpha", { currentBranch: "b2" }),
              workspace("ws-idle", "beta", { currentBranch: "b3" }),
              workspace("ws-fresh", "beta2", { currentBranch: "b4" }),
              workspace("ws-none", "aardvark", { currentBranch: "b5" }),
            ],
            { projectId: "proj-1" },
          ),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          id: "s1",
          workspaceId: "ws-live",
          status: "running",
          lastActivityAt: new Date(1),
        }),
        agent({
          serverId: "host-a",
          id: "s2",
          workspaceId: "ws-idle",
          lastActivityAt: new Date(9_000),
        }),
        agent({
          serverId: "host-a",
          id: "s3",
          workspaceId: "ws-fresh",
          lastActivityAt: new Date(5_000),
        }),
      ],
      workspacePaths: new Map([
        ["host-a:ws-live", "/repo/live"],
        ["host-a:ws-cold", "/repo/cold"],
        ["host-a:ws-idle", "/repo/idle"],
        ["host-a:ws-fresh", "/repo/fresh"],
        ["host-a:ws-none", "/repo/none"],
      ]),
    });
    const names = section(sections, "host-a").projects[0].worktrees.map((row) => row.name);
    // 活跃 first; then lastUsedAt desc; then never-used by 字典序 (aardvark < alpha).
    expect(names).toEqual(["zeta", "beta", "beta2", "aardvark", "alpha"]);
  });

  it("L1 sorts by aggregated activity, then recency; empty projects hidden", () => {
    const sections = build({
      projects: [
        project("v1", [hostEntry("host-a", "aaa", [], { projectId: "proj-empty" })]),
        project("v2", [
          hostEntry("host-a", "paseo", [workspace("ws-live", "x")], { projectId: "proj-live" }),
        ]),
        project("v3", [
          hostEntry("host-a", "zzz", [workspace("ws-quiet", "q")], { projectId: "proj-quiet" }),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          id: "s1",
          workspaceId: "ws-live",
          status: "running",
          lastActivityAt: new Date(1),
        }),
      ],
      workspacePaths: new Map([
        ["host-a:ws-live", "/repo/live"],
        ["host-a:ws-quiet", "/repo/quiet"],
      ]),
    });
    const host = section(sections, "host-a");
    expect(host.projects.map((row) => row.name)).toEqual(["paseo", "zzz"]);
    expect(host.projects[0].lastUsedAt).toBe(1);
    expect(host.projects[1].lastUsedAt).toBeNull();
  });

  it("L3 sorts by chatLastEventAt desc — attention stamps count", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])])],
      agents: [
        agent({
          serverId: "host-a",
          id: "old",
          workspaceId: "ws-1",
          lastActivityAt: new Date(1_000),
        }),
        agent({
          serverId: "host-a",
          id: "quiet-activity",
          workspaceId: "ws-1",
          lastActivityAt: new Date(2_000),
        }),
        agent({
          serverId: "host-a",
          id: "attentioned",
          workspaceId: "ws-1",
          lastActivityAt: new Date(1_500),
          attentionTimestamp: new Date(3_000),
        }),
      ],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
    });
    const sessions = section(sections, "host-a").projects[0].worktrees[0].sessions;
    expect(sessions.map((s) => s.agentId)).toEqual(["attentioned", "quiet-activity", "old"]);
  });
});

describe("buildWorkspaceTree — 无会话 / 空态 / 主机", () => {
  it("a worktree with no agents is a session-less L2 row", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "main")])])],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
    });
    const l2 = section(sections, "host-a").projects[0].worktrees[0];
    expect(l2.sessions).toEqual([]);
    expect(l2.activeCount).toBe(0);
    expect(l2.lastUsedAt).toBeNull();
  });

  it("offline hosts keep their cached tree, flagged offline; online hosts sort first", () => {
    const sections = build({
      statuses: new Map([
        ["host-a", "offline"],
        ["host-b", "online"],
      ]),
      projects: [
        project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])]),
        project("v2", [hostEntry("host-b", "other", [workspace("ws-2", "b")])]),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "/repo/x"],
        ["host-b:ws-2", "/repo/y"],
      ]),
    });
    expect(sections.map((entry) => entry.serverId)).toEqual(["host-b", "host-a"]);
    expect(section(sections, "host-a").isOnline).toBe(false);
    expect(section(sections, "host-a").status).toBe("offline");
    expect(section(sections, "host-a").projects).toHaveLength(1);
  });

  it("unknown status reads as connecting; hosts without projects stay empty", () => {
    const sections = build({ statuses: new Map() });
    expect(sections[0]?.status).toBe("connecting");
    expect(sections[0]?.isOnline).toBe(false);
    expect(sections[0]?.projects).toEqual([]);
  });
});

// R2-14: the L3 twin of chatLastEventAtFromAgent over the same untrusted
// protocol date fields. Garbage dates must read as "no trustworthy stamp"
// (null → lastUsedAt stays null, the row sinks like a never-used one), never
// as NaN — NaN used to poison the tree sort comparators and the L2 lastUsedAt
// the screen renders.
describe("R2-14 — garbage host dates never produce NaN", () => {
  it("workspaceAgentLastEventAt: null when every date is garbage, the trustworthy one otherwise", () => {
    expect(
      workspaceAgentLastEventAt(
        agent({ serverId: "h", id: "a", lastActivityAt: new Date("not-a-date") }),
      ),
    ).toBeNull();
    expect(
      workspaceAgentLastEventAt(
        agent({
          serverId: "h",
          id: "a",
          lastActivityAt: new Date("not-a-date"),
          attentionTimestamp: new Date(2_500),
        }),
      ),
    ).toBe(2_500);
    expect(
      workspaceAgentLastEventAt(
        agent({
          serverId: "h",
          id: "a",
          lastActivityAt: new Date(3_000),
          attentionTimestamp: new Date("not-a-date"),
        }),
      ),
    ).toBe(3_000);
  });

  it("tree: garbage dates sink like never-used; a trustworthy sibling still sorts", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])])],
      agents: [
        agent({
          serverId: "host-a",
          id: "ag-garbage",
          workspaceId: "ws-1",
          lastActivityAt: new Date("not-a-date"),
        }),
        agent({
          serverId: "host-a",
          id: "ag-good",
          workspaceId: "ws-1",
          lastActivityAt: new Date(2_000),
        }),
      ],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
    });
    const l2 = section(sections, "host-a").projects[0].worktrees[0];
    expect(l2.lastUsedAt).toBe(2_000);
    // 可信戳在前，垃圾日期沉底（0=epoch 序），且排序确定性回落到 key。
    expect(l2.sessions.map((s) => s.agentId)).toEqual(["ag-good", "ag-garbage"]);
    expect(l2.sessions.every((s) => Number.isFinite(s.lastEventAt))).toBe(true);
  });
});

// R2-09: Windows drive/UNC locator folding in normalizeWorkspacePath — the app-side
// mirror of the server's comparison semantics (packages/server/src/utils/path.ts is
// the truth source: looksLikeDefiniteWindowsPath + normalizePathForComparison).
// Boundary table: drive letters fold (C:\x ≡ c:/x), UNC server+share fold, the \\?\
// device namespace folds to its plain form, POSIX paths stay byte-identical
// (case-sensitive host — folding there would merge genuinely different directories).
describe("R2-09 — Windows 路径形折叠 (identity only)", () => {
  it.each([
    ["C:\\x", "c:/x"],
    ["c:/x", "c:/x"],
    ["C:\\Work\\Repo\\", "c:/Work/Repo"],
    ["C:\\", "c:/"],
    ["c:/", "c:/"],
    ["\\\\SRV1\\Share\\a", "//srv1/share/a"],
    ["\\\\?\\C:\\x", "c:/x"],
    ["\\\\?\\UNC\\SRV\\Share\\a", "//srv/share/a"],
    ["/a/b", "/a/b"],
    ["/A/B", "/A/B"],
    ["~/ProJ", "~/ProJ"],
  ])("normalizeWorkspacePath(%j) → %j", (input, expected) => {
    expect(normalizeWorkspacePath(input)).toBe(expected);
  });

  it("tree merges drive-case variants and keeps POSIX case-split rows apart", () => {
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-1", "one", { currentBranch: "main" }),
            workspace("ws-2", "two", { currentBranch: "main" }),
            workspace("ws-3", "three", { currentBranch: "main" }),
            workspace("ws-4", "four", { currentBranch: "main" }),
          ]),
        ]),
      ],
      workspacePaths: new Map([
        ["host-a:ws-1", "C:\\work\\repo"],
        ["host-a:ws-2", "c:/work/repo"],
        ["host-a:ws-3", "/a/b"],
        ["host-a:ws-4", "/A/B"],
      ]),
    });
    const worktrees = section(sections, "host-a").projects[0].worktrees;
    expect(worktrees).toHaveLength(3);
    const driveRow = worktrees.find((row) => row.workspaceIds.includes("ws-1"));
    expect(driveRow?.workspaceIds).toEqual(["ws-1", "ws-2"]);
    expect(driveRow?.cwd).toBe("c:/work/repo");
    expect(worktrees.filter((row) => row.cwd === "/a/b")).toHaveLength(1);
    expect(worktrees.filter((row) => row.cwd === "/A/B")).toHaveLength(1);
  });
});

// R2-08①: 壳归档 (the local archive store, the key the 对话 tab already honors)
// must reach the workspace tab too — archived sessions leave L3, stop feeding the
// badges/recency, and the L2/L1 rows themselves survive (归档 is per-session).
describe("R2-08① — archivedIds 剔 L3、角标不计", () => {
  it("drops archived sessions from L3 and their counts from the L2/L1 badges", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])])],
      agents: [
        agent({ serverId: "host-a", id: "ag-live", workspaceId: "ws-1", status: "running" }),
        agent({
          serverId: "host-a",
          id: "ag-arch",
          workspaceId: "ws-1",
          status: "idle",
          requiresAttention: true,
          attentionReason: "permission",
          pendingPermissionCount: 1,
        }),
      ],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
      archivedIds: ["host-a:ag-arch"],
    });
    const l1 = section(sections, "host-a").projects[0];
    const l2 = l1.worktrees[0];
    expect(l2.sessions.map((s) => s.agentId)).toEqual(["ag-live"]);
    expect(l2.activeCount).toBe(1);
    expect(l2.needsInputCount).toBe(0);
    expect(l1.activeCount).toBe(1);
    expect(l1.needsInputCount).toBe(0);
  });

  it("keeps the L2/L1 rows themselves — 归档 is per-session, not per-worktree", () => {
    const sections = build({
      projects: [project("v1", [hostEntry("host-a", "paseo", [workspace("ws-1", "a")])])],
      agents: [
        agent({
          serverId: "host-a",
          id: "ag-arch",
          workspaceId: "ws-1",
          status: "running",
        }),
      ],
      workspacePaths: new Map([["host-a:ws-1", "/repo/x"]]),
      archivedIds: ["host-a:ag-arch"],
    });
    const l1 = section(sections, "host-a").projects[0];
    expect(l1.worktrees).toHaveLength(1);
    expect(l1.worktrees[0].sessions).toEqual([]);
    expect(l1.worktrees[0].activeCount).toBe(0);
  });

  it("an archived agent's activity no longer elects the representative record", () => {
    // 代表记录 election reads the same stats the badges do — when the newest
    // record's only activity belongs to an archived session, the row title/files
    // target must come from a live record.
    const sections = build({
      projects: [
        project("v1", [
          hostEntry("host-a", "paseo", [
            workspace("ws-old", "old", { currentBranch: "main" }),
            workspace("ws-new", "new", { currentBranch: "main" }),
          ]),
        ]),
      ],
      agents: [
        agent({
          serverId: "host-a",
          id: "ag-old",
          workspaceId: "ws-old",
          lastActivityAt: new Date(1_000),
        }),
        agent({
          serverId: "host-a",
          id: "ag-new",
          workspaceId: "ws-new",
          lastActivityAt: new Date(9_000),
        }),
      ],
      workspacePaths: new Map([
        ["host-a:ws-old", "/repo/x"],
        ["host-a:ws-new", "/repo/x"],
      ]),
      archivedIds: ["host-a:ag-new"],
    });
    const l2 = section(sections, "host-a").projects[0].worktrees[0];
    expect(l2.workspaceId).toBe("ws-old");
    expect(l2.lastUsedAt).toBe(1_000);
  });
});
