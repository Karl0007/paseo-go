// R2-08② regression (回炉 after the CLOSE-DEV3 device FAIL): the L2 长按「归档工作区」
// must clear the OFFICIAL worktree archive risk gate before the destructive RPC fires.
// The gate is the official batch wrapper selectProjectWorkspacesToArchive
// (workspace/project-workspace-archive.ts), which runs
// confirmRiskyWorktreeArchive({ workspaceName, ...toWorktreeArchiveRisk(…) }) per record
// — the exact call shape sidebar-workspace-list.tsx's rows use. Baseline had NO gate:
// the shell archived straight through (REVIEW2 R2-08 复核 CONFIRMED).
//
// Device miss (b2-09/b2-10): the descriptor's gitRuntime is server-filled only once the
// lazy git-observer snapshot resolves (session.ts describeWorkspaceRecordWithGitData
// returns the base WITHOUT gitRuntime while peekSnapshot is empty), and the official
// confirm auto-passes on null risks — the gate stood permanently open. The two layers
// pinned here: (1) risks are overlaid from the official live checkout-status query at
// action time; (2) an UNRESOLVED risk must raise the generic warning confirm instead of
// auto-passing (fail-closed), while a known-clean record keeps auto-passing and a
// known-risky one keeps the official destructive dialog.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceArchiveFailure } from "@/workspace/workspace-archive";
import { i18n } from "@/i18n/i18next";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { buildWorktreeArchiveConfirmationMessage } from "@/git/worktree-archive-warning";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import {
  archiveWorktreeRowWithRiskGate,
  buildWorktreeArchiveEntries,
  type WorktreeArchiveLiveRisk,
} from "./archive-gate";

// The gate's dialogs (official + generic fail-closed) both surface through the single
// confirmDialog door — mocking it keeps the REAL selectProjectWorkspacesToArchive /
// confirmRiskyWorktreeArchive chain under test.
vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

const confirmDialogMock = confirmDialog as unknown as Mock;

const GENERIC_MESSAGE = i18n.t(`${SHELL_I18N_NAMESPACE}:workspace.archiveGate.unknownRiskMessage`);

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

const noLiveRisk = async (): Promise<WorktreeArchiveLiveRisk | null> => null;

beforeEach(() => {
  confirmDialogMock.mockReset();
  confirmDialogMock.mockImplementation(async () => true);
});

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

describe("archiveWorktreeRowWithRiskGate 真值源 overlay (官方 live checkout-status)", () => {
  it("live dirty resolves a null-risk descriptor into the OFFICIAL destructive dialog", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: async () => ({ isDirty: true, aheadOfOrigin: 0 }),
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    // The mock records exactly the ConfirmDialogInput the gate passed.
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    // Official message (reasons-backed), NOT the generic fail-closed warning.
    expect(dialog.message).not.toBe(GENERIC_MESSAGE);
    expect(dialog.message).toBe(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "feature",
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    );
    expect(dialog.destructive).toBe(true);
    expect(archive).toHaveBeenCalledOnce();
  });

  it("live clean resolves a null-risk descriptor → auto-pass stays (no dialog at all)", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: async () => ({ isDirty: false, aheadOfOrigin: 0 }),
      archive,
    });
    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledOnce();
  });

  it("live risk wins over a stale clean descriptor (dirty worktree must confirm)", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          gitRuntime: { isDirty: false, aheadOfOrigin: 0 } as WorkspaceDescriptor["gitRuntime"],
        }),
      ],
    ]);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: async () => ({ isDirty: true, aheadOfOrigin: 0 }),
      archive: async () => [],
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
  });

  it("queries the official live status ONCE per distinct worktree directory", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      ["w1", descriptor({ id: "w1", workspaceDirectory: "C:\\repo\\wt" })],
      ["w2", descriptor({ id: "w2", workspaceDirectory: "c:/repo/wt" })],
    ]);
    const fetchLiveRisk = vi.fn(noLiveRisk);
    await archiveWorktreeRowWithRiskGate({
      row: ROW,
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk,
      archive: async () => [],
    });
    // Same physical directory under both shapes the daemon reports (R2-09 identity).
    expect(fetchLiveRisk).toHaveBeenCalledOnce();
    expect(fetchLiveRisk).toHaveBeenCalledWith("s1", "C:\\repo\\wt");
  });

  it("a failing live query degrades to the fail-closed dialog, never to auto-pass", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: async () => {
        throw new Error("daemon offline");
      },
      archive: async () => [],
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(GENERIC_MESSAGE);
  });
});

describe("archiveWorktreeRowWithRiskGate fail-closed (null-risk 必弹, R2-08② 设备实锤)", () => {
  it("null risks (descriptor without gitRuntime, no live source) MUST raise the generic warning", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(GENERIC_MESSAGE);
    expect(dialog.title).toContain("feature");
    expect(dialog.destructive).toBe(true);
    // Confirmed → the archive still happens.
    expect(archive).toHaveBeenCalledOnce();
  });

  it("declining the generic warning is a pure no-op", async () => {
    confirmDialogMock.mockImplementation(async () => false);
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    const archive = vi.fn();
    const result = await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    expect(archive).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: [], failures: [] });
  });

  it("a store-missing record (device事故形态) must confirm, not auto-pass", async () => {
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: () => undefined,
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(GENERIC_MESSAGE);
    // Confirmed (mock accepts) → the record still archives; decline-no-op is pinned above.
    expect(archive).toHaveBeenCalledWith([{ serverId: "s1", workspaceId: "w1" }]);
  });

  it("known-dirty descriptor still gets the official dialog (rich message, not generic)", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          gitRuntime: { isDirty: true, aheadOfOrigin: 3 } as WorkspaceDescriptor["gitRuntime"],
          diffStat: { additions: 5, deletions: 1 },
        }),
      ],
    ]);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive: async () => [],
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).not.toBe(GENERIC_MESSAGE);
    expect(dialog.message).toBe(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "feature",
        isDirty: true,
        aheadOfOrigin: 3,
        diffStat: { additions: 5, deletions: 1 },
      }),
    );
  });

  it("known-clean descriptor auto-passes with no dialog", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          gitRuntime: { isDirty: false, aheadOfOrigin: 0 } as WorkspaceDescriptor["gitRuntime"],
        }),
      ],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledOnce();
  });

  it("mixed row: clean record passes silently, null-risk record alone gets the warning", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          name: "clean",
          workspaceDirectory: "/repo/clean",
          gitRuntime: { isDirty: false, aheadOfOrigin: 0 } as WorkspaceDescriptor["gitRuntime"],
        }),
      ],
      ["w2", descriptor({ id: "w2", name: "unknown", workspaceDirectory: "/repo/unknown" })],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: ROW,
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.title).toContain("unknown");
    expect(archive).toHaveBeenCalledWith([
      { serverId: "s1", workspaceId: "w1" },
      { serverId: "s1", workspaceId: "w2" },
    ]);
  });

  it("directory-kind records keep the official skip (no confirm for non-worktrees)", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      ["w1", descriptor({ id: "w1", workspaceKind: "directory" })],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledOnce();
  });
});

// FixB4 (CLOSE-DEV4 g5-00..03 device 实锤): the FixB3 gate covered kind==="worktree"
// only — selectProjectWorkspacesToArchive AND overlayLiveCheckoutRisk both skip
// non-worktree records, so the CLOSE-DEV3 accident surface (main worktree row =
// local_checkout; the 23+23 cascade) still archived with ZERO dialogs (one-shot
// fixture gate-main: row gone, archivedAt set, no dialog in the 2s/5s dumps). The
// shell gate now confirms every git-checkout kind through the IDENTICAL overlay +
// fail-closed layers — an intentional deviation from the official skip semantics
// (paseo-go/UPSTREAM-ISSUES.md #3).
describe("archiveWorktreeRowWithRiskGate local_checkout 入闸 (FixB4, CLOSE-DEV4 g5)", () => {
  it("known-dirty local_checkout gets the OFFICIAL rich dialog (was: zero dialogs)", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          workspaceKind: "local_checkout",
          gitRuntime: { isDirty: true, aheadOfOrigin: 2 } as WorkspaceDescriptor["gitRuntime"],
          diffStat: { additions: 1, deletions: 0 },
        }),
      ],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).not.toBe(GENERIC_MESSAGE);
    expect(dialog.message).toBe(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "feature",
        isDirty: true,
        aheadOfOrigin: 2,
        diffStat: { additions: 1, deletions: 0 },
      }),
    );
    expect(dialog.destructive).toBe(true);
    expect(archive).toHaveBeenCalledOnce();
  });

  it("null-risk local_checkout raises the generic fail-closed warning", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      ["w1", descriptor({ id: "w1", workspaceKind: "local_checkout" })],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(GENERIC_MESSAGE);
    expect(archive).toHaveBeenCalledOnce();
  });

  it("known-clean local_checkout keeps auto-passing (直通保持)", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          workspaceKind: "local_checkout",
          gitRuntime: { isDirty: false, aheadOfOrigin: 0 } as WorkspaceDescriptor["gitRuntime"],
        }),
      ],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledOnce();
  });

  it("live overlay queries a local_checkout's cwd and resolves null risks into the official dialog", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          workspaceKind: "local_checkout",
          workspaceDirectory: "C:\\repo\\main",
        }),
      ],
    ]);
    const fetchLiveRisk = vi.fn(
      async (): Promise<WorktreeArchiveLiveRisk> => ({
        isDirty: true,
        aheadOfOrigin: 0,
      }),
    );
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk,
      archive: async () => [],
    });
    expect(fetchLiveRisk).toHaveBeenCalledWith("s1", "C:\\repo\\main");
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).not.toBe(GENERIC_MESSAGE);
  });

  it("declining the local_checkout confirm is a pure no-op", async () => {
    confirmDialogMock.mockImplementation(async () => false);
    const byId = new Map<string, WorkspaceDescriptor>([
      ["w1", descriptor({ id: "w1", workspaceKind: "local_checkout" })],
    ]);
    const archive = vi.fn();
    const result = await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    expect(archive).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: [], failures: [] });
  });
});

// FixB4 级联计数: the official rich message states git facts only (uncommitted /
// unpushed) — never the session cascade that WAS the CLOSE-DEV3 blast radius
// (23+23). The shell appends the merged row's session count (row.sessions = the L3
// membership the server cascade archives, archiveWorkspaceContents by workspaceId —
// kind-AGNOSTIC, verified in packages/server workspace-archive-service.ts) to its
// fail-closed warning; and because that teardown is kind-agnostic, a directory-kind
// record that carries sessions cascades exactly like a worktree record: it gets the
// cascade dialog (no git risk exists there to show). A session-less directory row
// keeps the official skip — nothing destructive happens beyond the record.
describe("archiveWorktreeRowWithRiskGate 级联会话计数 + directory 入闸 (FixB4)", () => {
  const sessions = [{ agentId: "a1" }, { agentId: "a2" }];
  const CASCADE_TEXT = i18n.t(`${SHELL_I18N_NAMESPACE}:workspace.archiveGate.cascadeSessions`, {
    count: 2,
  });
  const DIRECTORY_CASCADE_MESSAGE = i18n.t(
    `${SHELL_I18N_NAMESPACE}:workspace.archiveGate.directoryCascadeMessage`,
    { count: 2 },
  );

  it("generic warning states the row's cascade session count", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"], sessions },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive: async () => [],
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(`${GENERIC_MESSAGE}\n${CASCADE_TEXT}`);
  });

  it("generic warning keeps the plain message for a session-less row", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([["w1", descriptor({ id: "w1" })]]);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive: async () => [],
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(GENERIC_MESSAGE);
  });

  it("directory record WITH sessions must confirm the cascade; declining is a pure no-op", async () => {
    confirmDialogMock.mockImplementation(async () => false);
    const byId = new Map<string, WorkspaceDescriptor>([
      ["w1", descriptor({ id: "w1", workspaceKind: "directory" })],
    ]);
    const archive = vi.fn();
    const result = await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"], sessions },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    const dialog = confirmDialogMock.mock.calls[0][0] as ConfirmDialogInput;
    expect(dialog.message).toBe(DIRECTORY_CASCADE_MESSAGE);
    expect(dialog.destructive).toBe(true);
    expect(archive).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: [], failures: [] });
  });

  it("confirmed directory cascade archives the record; no git RPC is spent on its cwd", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({ id: "w1", workspaceKind: "directory", workspaceDirectory: "/plain/dir" }),
      ],
    ]);
    const fetchLiveRisk = vi.fn(noLiveRisk);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"], sessions },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    expect(fetchLiveRisk).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledWith([{ serverId: "s1", workspaceId: "w1" }]);
  });

  it("directory record on a session-less row keeps the official skip", async () => {
    const byId = new Map<string, WorkspaceDescriptor>([
      ["w1", descriptor({ id: "w1", workspaceKind: "directory" })],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, workspaceIds: ["w1"] },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledOnce();
  });

  it("mixed row: declining the directory cascade drops ONLY the directory record", async () => {
    confirmDialogMock.mockImplementation(async () => false);
    const byId = new Map<string, WorkspaceDescriptor>([
      [
        "w1",
        descriptor({
          id: "w1",
          name: "clean",
          workspaceDirectory: "/repo/clean",
          gitRuntime: { isDirty: false, aheadOfOrigin: 0 } as WorkspaceDescriptor["gitRuntime"],
        }),
      ],
      ["w2", descriptor({ id: "w2", name: "dir", workspaceKind: "directory" })],
    ]);
    const archive = vi.fn(async () => []);
    await archiveWorktreeRowWithRiskGate({
      row: { ...ROW, sessions },
      descriptorOf: (_serverId, id) => byId.get(id),
      fetchLiveRisk: noLiveRisk,
      archive,
    });
    expect(confirmDialogMock).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledWith([{ serverId: "s1", workspaceId: "w1" }]);
  });
});
