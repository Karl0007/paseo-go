// C8 acceptance (概览卡): the counts are the three subscriptions' lengths, and 活跃
// mirrors the workspace badge exactly — running/initializing/permission-parked
// count, finished-attention and idle/closed do not.
import { describe, expect, it } from "vitest";
import { buildShellOverview } from "@/shell/overview";
import type { WorkspaceTreeAgent } from "@/shell/workspace/derive";

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

describe("buildShellOverview", () => {
  it("counts hosts, projects and active agents from the raw subscriptions", () => {
    const counts = buildShellOverview({
      hosts: [{ serverId: "srv-A" }, { serverId: "srv-B" }],
      projects: [{}, {}, {}, {}, {}],
      agents: [
        agent(),
        agent({ status: "initializing" }),
        agent({ status: "idle", requiresAttention: true, attentionReason: "permission" }),
        agent({ status: "idle" }),
        agent({ status: "closed" }),
        agent({ status: "running", requiresAttention: true, attentionReason: "finished" }),
      ],
    });
    expect(counts).toEqual({ hostCount: 2, projectCount: 5, activeAgentCount: 4 });
  });

  it("is zero-safe on cold subscriptions", () => {
    expect(buildShellOverview({ hosts: [], projects: [], agents: [] })).toEqual({
      hostCount: 0,
      projectCount: 0,
      activeAgentCount: 0,
    });
  });
});
