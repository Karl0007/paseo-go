// C10 验收 2：导入项映射/选择态纯逻辑单测。覆盖：key 形态、去重+倒序、标题/预览
// 回退、勾选幂等与取消、导入结果分类（daemon 的「already imported」幂等语义）。
import { describe, expect, it } from "vitest";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import {
  buildImportToastParts,
  classifyImportError,
  deriveImportStatus,
  importRowKey,
  mapEntriesToImportRows,
  summarizeImportAttempts,
  toggleRowSelection,
  type ImportStatusInput,
} from "./rows";

function entry(
  overrides: Partial<FetchRecentProviderSessionEntry> = {},
): FetchRecentProviderSessionEntry {
  return {
    providerId: "codex",
    providerLabel: "Codex",
    providerHandleId: "handle-1",
    cwd: "C:/work/repo",
    title: "Fix flaky test",
    firstPromptPreview: "fix the flaky suite",
    lastPromptPreview: "done",
    lastActivityAt: "2026-09-25T08:00:00.000Z",
    ...overrides,
  };
}

describe("mapEntriesToImportRows", () => {
  it("keys rows by providerId:providerHandleId and carries import facts", () => {
    const [row] = mapEntriesToImportRows([entry()], () => null);
    expect(row).toMatchObject({
      key: "codex:handle-1",
      providerId: "codex",
      providerLabel: "Codex",
      providerHandleId: "handle-1",
      cwd: "C:/work/repo",
      title: "Fix flaky test",
      preview: "done", // 官方 getPromptPreview：lastPromptPreview 优先于 first
      lastActivityAt: Date.parse("2026-09-25T08:00:00.000Z"),
    });
  });

  it("dedupes repeated handles and sorts newest activity first", () => {
    const rows = mapEntriesToImportRows(
      [
        entry({ providerHandleId: "old", lastActivityAt: "2026-09-24T00:00:00.000Z" }),
        entry({ providerHandleId: "new", lastActivityAt: "2026-09-25T00:00:00.000Z" }),
        entry({ providerHandleId: "old", lastActivityAt: "2026-09-24T00:00:00.000Z" }),
      ],
      () => null,
    );
    expect(rows.map((row) => row.providerHandleId)).toEqual(["new", "old"]);
    expect(rows.map((row) => row.key)).toEqual(["codex:new", "codex:old"]);
  });

  it("keeps same-handle rows from different providers apart", () => {
    const rows = mapEntriesToImportRows([entry(), entry({ providerId: "claude" })], () => null);
    expect(rows.map((row) => row.key)).toEqual(["codex:handle-1", "claude:handle-1"]);
  });

  it("falls back through the official title chain and maps the folder label", () => {
    const [row] = mapEntriesToImportRows(
      [entry({ title: "   ", firstPromptPreview: null, lastPromptPreview: "tail only" })],
      (cwd) => (cwd === "C:/work/repo" ? "repo" : null),
    );
    expect(row.title.length).toBeGreaterThan(0); // 官方回退链：空标题 → 预览/占位
    expect(row.folder).toBe("repo");
  });
});

describe("toggleRowSelection", () => {
  it("adds, removes and never duplicates", () => {
    let selected: string[] = [];
    selected = toggleRowSelection(selected, "a");
    selected = toggleRowSelection(selected, "b");
    expect(selected).toEqual(["a", "b"]);
    selected = toggleRowSelection(selected, "a");
    expect(selected).toEqual(["b"]);
    selected = toggleRowSelection(selected, "ghost");
    selected = toggleRowSelection(selected, "ghost");
    expect(selected).toEqual(["b"]);
  });
});

describe("summarizeImportAttempts + classifyImportError", () => {
  it("splits outcomes into imported / already-imported / failed", () => {
    expect(
      summarizeImportAttempts([
        { key: "a", ok: true },
        { key: "b", ok: false, alreadyImported: true },
        { key: "c", ok: false, alreadyImported: false },
        { key: "d", ok: false },
      ]),
    ).toEqual({ imported: 1, alreadyImported: 1, failed: 2 });
  });

  it("recognises the daemon duplicate-import error as idempotent", () => {
    expect(
      classifyImportError(new Error("Provider session is already imported: thread-1")),
    ).toEqual({
      alreadyImported: true,
      message: "Provider session is already imported: thread-1",
    });
    expect(classifyImportError(new Error("boom"))).toEqual({
      alreadyImported: false,
      message: "boom",
    });
    expect(classifyImportError("socket closed").message).toBe("socket closed");
  });

  it("row key helper matches the mapping", () => {
    expect(importRowKey(entry({ providerId: "pi", providerHandleId: "s/2" }))).toBe("pi:s/2");
  });
});

describe("deriveImportStatus", () => {
  const ready: ImportStatusInput = {
    hostCount: 1,
    hasServerId: true,
    supportsSnapshot: true,
    hasClient: true,
    listStatus: "ready",
    rowCount: 3,
    alreadyImportedCount: 0,
    hasNoImportableProviders: false,
  };

  it("prioritises missing-host over every later gate", () => {
    expect(deriveImportStatus({ ...ready, hostCount: 0, listStatus: "error" })?.key).toBe(
      "import.noHostsBody",
    );
    expect(deriveImportStatus({ ...ready, hasServerId: false })?.key).toBe("import.pickHost");
    expect(deriveImportStatus({ ...ready, supportsSnapshot: false })?.key).toBe(
      "import.status.updateHost",
    );
    expect(deriveImportStatus({ ...ready, hasClient: false })?.key).toBe(
      "import.status.connectHost",
    );
  });

  it("carries the load failure message and hides already-imported count in the empty state", () => {
    expect(
      deriveImportStatus({ ...ready, listStatus: "error", errorMessage: "socket died" }),
    ).toEqual({ key: "import.status.failed", params: { message: "socket died" } });
    expect(deriveImportStatus({ ...ready, rowCount: 0, alreadyImportedCount: 4 })).toEqual({
      key: "import.alreadyHidden",
      params: { count: 4 },
    });
    expect(deriveImportStatus({ ...ready, rowCount: 0 })?.key).toBe("import.empty");
  });

  it("reports no-provider and loading states, and stays silent once rows exist", () => {
    expect(deriveImportStatus({ ...ready, hasNoImportableProviders: true })?.key).toBe(
      "import.status.noProviders",
    );
    expect(deriveImportStatus({ ...ready, listStatus: "loading", rowCount: 0 })?.key).toBe(
      "import.status.loading",
    );
    expect(deriveImportStatus({ ...ready, listStatus: "loading" })).toBeNull();
    expect(deriveImportStatus(ready)).toBeNull();
  });
});

describe("buildImportToastParts", () => {
  it("emits only non-zero segments, in imported/already/failed order", () => {
    expect(buildImportToastParts({ imported: 0, alreadyImported: 0, failed: 0 })).toEqual([]);
    expect(buildImportToastParts({ imported: 2, alreadyImported: 0, failed: 1 })).toEqual([
      { key: "imported", count: 2 },
      { key: "failed", count: 1 },
    ]);
    expect(buildImportToastParts({ imported: 0, alreadyImported: 3, failed: 0 })).toEqual([
      { key: "already", count: 3 },
    ]);
  });
});
