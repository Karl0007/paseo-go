// C8 acceptance (概览卡): the counts are the three subscriptions' lengths, and 活跃
// mirrors the workspace badge exactly — which since R2-06 means the OFFICIAL
// bucket's live set (running / needs_input). initializing (bucket done) and
// finished-attention do not count; a count-only permission request does.
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
    // R2-06: initializing is bucket-done (the row light is grey) — no longer
    // counted; the badge and the 对话 tab can no longer disagree.
    expect(counts).toEqual({ hostCount: 2, projectCount: 5, activeAgentCount: 3 });
  });

  it("is zero-safe on cold subscriptions", () => {
    expect(buildShellOverview({ hosts: [], projects: [], agents: [] })).toEqual({
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
    });
    expect(counts.activeAgentCount).toBe(1);
  });
});
