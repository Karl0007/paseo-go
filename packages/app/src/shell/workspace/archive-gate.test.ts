// R2-08② regression: the L2 长按「归档工作区」 must clear the OFFICIAL worktree
// archive risk gate before the destructive RPC fires. The gate is the official
// batch wrapper selectProjectWorkspacesToArchive (workspace/project-workspace-archive.ts),
// which runs confirmRiskyWorktreeArchive({ workspaceName, ...toWorktreeArchiveRisk(…) })
// per record — the exact call shape sidebar-workspace-list.tsx's rows use. Baseline
// had NO gate: the shell archived straight through (REVIEW2 R2-08 复核 CONFIRMED).
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceArchiveFailure } from "@/workspace/workspace-archive";
import { archiveWorktreeRowWithRiskGate, buildWorktreeArchiveEntries } from "./archive-gate";

function descriptor(
  patch: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    projectId: "p1",
    projectDisplayName: "P",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "feature",
    status: "done",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
    ...patch,
  };
}

const ROW = { serverId: "s1", workspaceIds: ["w1", "w2"], name: "行名" };

describe("buildWorktreeArchiveEntries (风险闸输入装配)", () => {
  it("maps the official risk fields off the session-store descriptors", () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          name: "risky",
          gitRuntime: { isDirty: true, aheadOfOrigin: 3 } as WorkspaceDescriptor["gitRuntime"],
          diffStat: { additions: 5, deletions: 1 },
        }),
      ],
      ["w2", descriptor({ id: "w2", workspaceKind: "directory", name: "plain" })],
    ]);
    const entries = buildWorktreeArchiveEntries(ROW, (_serverId, id) => byId.get(id));
    expect(entries).toEqual([
      {
        serverId: "s1",
        workspaceId: "w1",
        workspaceKind: "worktree",
        name: "risky",
        archiveHasUncommittedChanges: true,
        archiveUnpushedCommitCount: 3,
        diffStat: { additions: 5, deletions: 1 },
      },
      {
        serverId: "s1",
        workspaceId: "w2",
        workspaceKind: "directory",
        name: "plain",
        archiveHasUncommittedChanges: null,
        archiveUnpushedCommitCount: null,
        diffStat: null,
      },
    ]);
  });

  it("a store-missing record still gets the worktree gate with null risks", () => {
    const [entry] = buildWorktreeArchiveEntries(ROW, () => undefined);
    expect(entry).toMatchObject({
      workspaceId: "w1",
      workspaceKind: "worktree",
      name: "行名",
      archiveHasUncommittedChanges: null,
      archiveUnpushedCommitCount: null,
      diffStat: null,
    });
  });
});

describe("archiveWorktreeRowWithRiskGate (先闸后归档)", () => {
  it("archives nothing when every record's risk confirm is declined", async () => {
    const archive = vi.fn();
    const select = vi.fn(async () => []);
    const result = await archiveWorktreeRowWithRiskGate({
      row: ROW,
      descriptorOf: () => undefined,
      select,
      archive,
    });
    expect(select).toHaveBeenCalledOnce();
    expect(archive).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: [], failures: [] });
  });

  it("archives ONLY the confirmed records when some declines", async () => {
    const failures: WorkspaceArchiveFailure[] = [];
    const archive = vi.fn(async () => failures);
    const result = await archiveWorktreeRowWithRiskGate({
      row: ROW,
      descriptorOf: () => undefined,
      select: async (_entries) => [{ serverId: "s1", workspaceId: "w1" }],
      archive,
    });
    expect(archive).toHaveBeenCalledWith([{ serverId: "s1", workspaceId: "w1" }]);
    expect(result.attempted).toEqual([{ serverId: "s1", workspaceId: "w1" }]);
    expect(result.failures).toBe(failures);
  });

  it("gates BEFORE the RPC — the archive call only ever sees confirmed targets", async () => {
    const order: string[] = [];
    await archiveWorktreeRowWithRiskGate({
      row: ROW,
      descriptorOf: () => undefined,
      select: async () => {
        order.push("gate");
        return [
          { serverId: "s1", workspaceId: "w1" },
          { serverId: "s1", workspaceId: "w2" },
        ];
      },
      archive: async () => {
        order.push("archive");
        return [];
      },
    });
    expect(order).toEqual(["gate", "archive"]);
  });
});
