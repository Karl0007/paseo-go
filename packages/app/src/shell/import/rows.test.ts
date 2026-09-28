// C10 验收 2：导入项映射/选择态纯逻辑单测。覆盖：key 形态、去重+倒序、标题/预览
// 回退、勾选幂等与取消、导入结果分类（daemon 的「already imported」幂等语义）。
// KI-4 验收 2：标题回退矩阵（last→first→官方）、nameLabel、buildImportTree
// （父子嵌套/孤儿子组/自父防御/两层展平/顺序保持）。
import { describe, expect, it } from "vitest";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import {
  buildImportToastParts,
  buildImportTree,
  classifyImportError,
  deriveImportParentLabel,
  deriveImportStatus,
  filterImportEntriesByQuery,
  importEntryMatchesQuery,
  importRowKey,
  importRowTimeLabel,
  mapEntriesToImportRows,
  summarizeImportAttempts,
  toggleRowSelection,
  type ImportStatusInput,
  type ImportTreeItem,
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
      // KI-4 裁定 2：标题=末次用户输入，官方 title 降级为 nameLabel。
      title: "done",
      nameLabel: "Fix flaky test",
      parentHandleId: null,
      preview: "done", // 字段保留在模型里（KI-5 契约），cell 不再渲染。
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

  it("falls back through the KI-4 title chain and maps the folder label", () => {
    const [row] = mapEntriesToImportRows(
      [entry({ title: "   ", firstPromptPreview: "head only", lastPromptPreview: "tail only" })],
      (cwd) => (cwd === "C:/work/repo" ? "repo" : null),
    );
    // KI-4 回退链=lastPromptPreview → firstPromptPreview → 官方 getSessionTitle；
    // 官方 title 只有空白 → nameLabel=null。钉具体值——`length > 0` 对任何
    // 非空垃圾都成立（R2-23 假绿修复纪律）。
    expect(row.title).toBe("tail only");
    expect(row.nameLabel).toBeNull();
    expect(row.preview).toBe("tail only");
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

// C23 验收 2：旧 daemon 降级的本地过滤纯函数 + 空态文案分流。
describe("filterImportEntriesByQuery (旧 daemon 本地降级)", () => {
  it("matches title / first / last preview / cwd, case-insensitively", () => {
    const cases: Array<[string, Partial<FetchRecentProviderSessionEntry>]> = [
      ["c13", { title: "C13 Release Gate" }],
      ["c13", { firstPromptPreview: "run the C13 smoke", title: null, lastPromptPreview: null }],
      ["c13", { lastPromptPreview: "C13 done", title: null, firstPromptPreview: null }],
      ["deploy", { cwd: "C:/work/deploy-repo", title: null }],
      ["中文", { title: "发布 中文 文档" }],
    ];
    for (const [query, overrides] of cases) {
      expect(importEntryMatchesQuery(entry(overrides), query)).toBe(true);
    }
  });

  it("misses when no haystack field contains the query; null fields never match", () => {
    expect(importEntryMatchesQuery(entry({ title: null }), "anything")).toBe(false);
    expect(
      importEntryMatchesQuery(
        entry({ title: "Alpha", firstPromptPreview: null, lastPromptPreview: "beta" }),
        "omega",
      ),
    ).toBe(false);
  });

  it("empty query keeps everything; filter preserves order and drops misses", () => {
    const entries = [
      entry({ providerHandleId: "h1", title: "C13 gate" }),
      entry({ providerHandleId: "h2", title: "Other" }),
      entry({ providerHandleId: "h3", title: "ship C13 notes" }),
    ];
    expect(filterImportEntriesByQuery(entries, "").map((e) => e.providerHandleId)).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
    expect(filterImportEntriesByQuery(entries, "c13").map((e) => e.providerHandleId)).toEqual([
      "h1",
      "h3",
    ]);
  });

  // R2-17 (FIX-A): the server truth (server/agent/agent-manager.ts
  // matchesImportableSessionQuery) puts basename(cwd.replaceAll("\\","/")) in
  // the haystack, not the full path. The degraded local filter must agree —
  // otherwise a parent-directory keyword silently finds rows the daemon-side
  // search would never return (and the comment claimed parity).
  it("cwd enters as basename: parent dirs never match (server parity)", () => {
    // 整条路径含 "packages"，basename "app" 不含 → 不命中（服务端口径）。
    expect(
      importEntryMatchesQuery(
        entry({ cwd: "C:/work/paseo-go/packages/app", title: null }),
        "packages",
      ),
    ).toBe(false);
    expect(
      importEntryMatchesQuery(entry({ cwd: "C:/work/paseo-go/packages/app", title: null }), "app"),
    ).toBe(true);
    // 反斜杠先归一再取尾段。
    expect(
      importEntryMatchesQuery(entry({ cwd: "C:\\work\\Deploy-Repo", title: null }), "deploy"),
    ).toBe(true);
    expect(
      importEntryMatchesQuery(entry({ cwd: "C:\\work\\Deploy-Repo", title: null }), "work"),
    ).toBe(false);
    // 尾分隔符不产生空尾段（node basename 语义）。
    expect(importEntryMatchesQuery(entry({ cwd: "C:/work/repo/", title: null }), "repo")).toBe(
      true,
    );
  });
});

describe("deriveImportStatus search branches", () => {
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

  it("distinguishes server-side miss from local-filter miss and outranks alreadyHidden", () => {
    expect(deriveImportStatus({ ...ready, rowCount: 0, hasQuery: true })?.key).toBe(
      "import.searchEmpty",
    );
    expect(
      deriveImportStatus({ ...ready, rowCount: 0, hasQuery: true, queryRunsLocally: true })?.key,
    ).toBe("import.searchEmptyLocal");
    expect(
      deriveImportStatus({ ...ready, rowCount: 0, hasQuery: true, alreadyImportedCount: 4 })?.key,
    ).toBe("import.searchEmpty");
    // 无 query 时空态回到既有文案。
    expect(deriveImportStatus({ ...ready, rowCount: 0, alreadyImportedCount: 4 })?.key).toBe(
      "import.alreadyHidden",
    );
  });
});

// C25-UI 验收：父链副标题与「可能活跃」徽标的映射矩阵（字段缺席=不渲染）。
describe("import row parent chain + looksActive", () => {
  it("prefers parentTitle, else falls back to the parentHandleId tail", () => {
    expect(
      deriveImportParentLabel({ parentTitle: "C13 发布闸", parentHandleId: "x/y.jsonl" }),
    ).toEqual({ text: "C13 发布闸", raw: false });
    expect(deriveImportParentLabel({ parentHandleId: "C:\\paseo\\s\\C13-release.jsonl" })).toEqual({
      text: "C13-release",
      raw: false,
    });
    expect(deriveImportParentLabel({ parentHandleId: "sess/inner/agent-7.jsonl" })).toEqual({
      text: "agent-7",
      raw: false,
    });
    // 文件名形态（无目录但有 .jsonl）仍走尾段规则，不算裸 id。
    expect(deriveImportParentLabel({ parentHandleId: "solo-run.jsonl" })).toEqual({
      text: "solo-run",
      raw: false,
    });
  });

  // R2-18: 父未进扫描窗时 daemon 只给原始父 id（无分隔符无扩展名）——它不是
  // 名字，不冒充父名：raw 标记 + 超长截断，屏改走「源:」措辞。
  it("flags bare parent ids instead of presenting them as names", () => {
    expect(deriveImportParentLabel({ parentHandleId: " 0198ab " })).toEqual({
      text: "0198ab",
      raw: true,
    });
    const long = deriveImportParentLabel({ parentHandleId: `0198${"ab".repeat(20)}` });
    expect(long).toEqual({ text: `0198${"ab".repeat(6)}…`, raw: true });
  });

  it("yields null when both fields are absent or blank (旧 daemon / claude codex)", () => {
    expect(deriveImportParentLabel({})).toBeNull();
    expect(deriveImportParentLabel({ parentTitle: "   ", parentHandleId: "" })).toBeNull();
    expect(deriveImportParentLabel({ parentHandleId: "///" })).toBeNull();
    // 标题只有空白时仍回退 handleId，不渲染空徽标。
    expect(deriveImportParentLabel({ parentTitle: " ", parentHandleId: "a/b.jsonl" })).toEqual({
      text: "b",
      raw: false,
    });
  });

  it("maps onto rows: parentLabel + looksActive only when the daemon sent them", () => {
    const [child, plain, idle] = mapEntriesToImportRows(
      [
        entry({
          providerId: "omp",
          providerHandleId: "child",
          parentHandleId: "C:/omp/sessions/C13-release.jsonl",
          parentTitle: "C13 发布闸",
          looksActive: true,
        }),
        entry({ providerId: "omp", providerHandleId: "plain" }),
        entry({
          providerId: "omp",
          providerHandleId: "idle",
          parentHandleId: "0198cd",
          looksActive: false,
        }),
      ],
      () => null,
    );
    expect(child).toMatchObject({
      parentLabel: "C13 发布闸",
      parentIsRawId: false,
      looksActive: true,
    });
    expect(plain).toMatchObject({ parentLabel: null, parentIsRawId: false, looksActive: false });
    expect(idle).toMatchObject({ parentLabel: "0198cd", parentIsRawId: true, looksActive: false });
  });
});

// R2-14: `lastActivityAt` is a bare z.string() on the wire — a non-compliant
// host can send "not-a-date". The row must carry null (unknown), sink like a
// never-timestamped entry, and the meta time segment must be a placeholder the
// screen picks, never the "Invalid Date NaN" the formatter produces for NaN.
describe("R2-14 — non-compliant host dates", () => {
  it("mapEntriesToImportRows: garbage date → null lastActivityAt, sinks below trustworthy rows", () => {
    const rows = mapEntriesToImportRows(
      [
        entry({ providerHandleId: "garbage", lastActivityAt: "not-a-date" }),
        entry({ providerHandleId: "ok", lastActivityAt: "2026-09-25T00:00:00.000Z" }),
        entry({ providerHandleId: "empty", lastActivityAt: "" }),
      ],
      () => null,
    );
    expect(rows.map((row) => row.providerHandleId)).toEqual(["ok", "garbage", "empty"]);
    expect(rows[0]?.lastActivityAt).toBe(Date.parse("2026-09-25T00:00:00.000Z"));
    expect(rows[1]?.lastActivityAt).toBeNull();
    expect(rows[2]?.lastActivityAt).toBeNull();
  });

  it("importRowTimeLabel: null for unknown; compact label for a real instant — never Invalid Date", () => {
    expect(importRowTimeLabel(null)).toBeNull();
    expect(
      importRowTimeLabel(
        Date.parse("2026-09-25T08:00:00.000Z"),
        new Date("2026-09-25T08:05:00.000Z"),
      ),
    ).toBe("5m");
  });
});

// KI-4 验收 2：标题回退矩阵（last→first→官方）+ nameLabel + buildImportTree
// （父子嵌套、孤儿子组聚合、自父防御、两层展平、顺序保持）。
describe("KI-4 title chain + nameLabel", () => {
  it("prefers lastPromptPreview, then firstPromptPreview, then the official title", () => {
    const [lastWins] = mapEntriesToImportRows(
      [entry({ title: "Official", firstPromptPreview: "F", lastPromptPreview: "L" })],
      () => null,
    );
    expect(lastWins.title).toBe("L");
    // 官方 title 与新 title 不同 → 降级 nameLabel（子代理名 ReworkR45 不丢）。
    expect(lastWins.nameLabel).toBe("Official");

    const [firstNext] = mapEntriesToImportRows(
      [entry({ title: "Official", firstPromptPreview: " F ", lastPromptPreview: "   " })],
      () => null,
    );
    expect(firstNext.title).toBe("F"); // trim 后判空，纯空白不算末次输入。
    expect(firstNext.nameLabel).toBe("Official");

    const [officialLast] = mapEntriesToImportRows(
      [entry({ title: "Official", firstPromptPreview: null, lastPromptPreview: null })],
      () => null,
    );
    expect(officialLast.title).toBe("Official");
    // 与新 title 相同 → null（meta 行不重复展示同一个名字）。
    expect(officialLast.nameLabel).toBeNull();
  });

  it("nameLabel is null without an official title; parentHandleId is trimmed, blanks null", () => {
    const [row] = mapEntriesToImportRows(
      [entry({ title: null, parentHandleId: "  C:/omp/s/parent.jsonl  " })],
      () => null,
    );
    expect(row.nameLabel).toBeNull();
    expect(row.parentHandleId).toBe("C:/omp/s/parent.jsonl");
    const [blank] = mapEntriesToImportRows([entry({ parentHandleId: "   " })], () => null);
    expect(blank.parentHandleId).toBeNull();
  });
});

function omp(
  handle: string,
  activity: string,
  overrides: Partial<FetchRecentProviderSessionEntry> = {},
): FetchRecentProviderSessionEntry {
  return entry({
    providerId: "omp",
    providerHandleId: handle,
    lastActivityAt: activity,
    ...overrides,
  });
}

/** 树形断言的可读形状：`handle@depth` / `group(label)@0`。 */
function treeShape(items: ImportTreeItem[]): string[] {
  return items.map((item) =>
    item.kind === "session"
      ? `${item.row.providerHandleId}@${item.depth}`
      : `group(${item.label?.text ?? "?"})@${item.depth}`,
  );
}

describe("buildImportTree", () => {
  it("nests children under the listed parent, newest child first", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("p", "2026-09-20T00:00:00.000Z"),
        omp("c1", "2026-09-22T00:00:00.000Z", { parentHandleId: "p" }),
        omp("c2", "2026-09-23T00:00:00.000Z", { parentHandleId: "p" }),
      ],
      () => null,
    );
    expect(treeShape(buildImportTree(rows))).toEqual(["p@0", "c2@1", "c1@1"]);
  });

  it("keeps tree order over global time order: children follow the parent row", () => {
    // 全局时间序会是 r, c1, p——树形裁定：r@0 先（根间倒序），但 c1 必须紧跟父 p。
    const rows = mapEntriesToImportRows(
      [
        omp("p", "2026-09-20T00:00:00.000Z"),
        omp("c1", "2026-09-25T00:00:00.000Z", { parentHandleId: "p" }),
        omp("r", "2026-09-22T00:00:00.000Z"),
      ],
      () => null,
    );
    expect(treeShape(buildImportTree(rows))).toEqual(["r@0", "p@0", "c1@1"]);
  });

  it("aggregates orphans of the same missing parent under one group header", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("o1", "2026-09-21T00:00:00.000Z", {
          parentHandleId: "C:/omp/s/alpha.jsonl",
          parentTitle: "Alpha run",
        }),
        omp("o2", "2026-09-24T00:00:00.000Z", {
          parentHandleId: "C:/omp/s/alpha.jsonl",
          parentTitle: "Alpha run",
        }),
        omp("r", "2026-09-22T00:00:00.000Z"),
      ],
      () => null,
    );
    // 组位置=组内最新活动（o2 09-24 > r 09-22）→ 组头在最前；成员时间倒序。
    expect(treeShape(buildImportTree(rows))).toEqual(["group(Alpha run)@0", "o2@1", "o1@1", "r@0"]);
    const header = buildImportTree(rows)[0];
    expect(header).toMatchObject({
      kind: "orphan-group",
      key: "orphan:omp:C:/omp/s/alpha.jsonl",
      label: { text: "Alpha run", raw: false },
    });
  });

  it("group label reuses the deriveImportParentLabel tri-state (path tail / raw id / null)", () => {
    const tail = buildImportTree(
      mapEntriesToImportRows(
        [omp("c", "2026-09-21T00:00:00.000Z", { parentHandleId: "C:/omp/s/beta.jsonl" })],
        () => null,
      ),
    );
    expect(tail[0]).toMatchObject({ kind: "orphan-group", label: { text: "beta", raw: false } });
    const raw = buildImportTree(
      mapEntriesToImportRows(
        [omp("c", "2026-09-21T00:00:00.000Z", { parentHandleId: "0198cdef0123456789ab" })],
        () => null,
      ),
    );
    expect(raw[0]).toMatchObject({
      kind: "orphan-group",
      label: { text: "0198cdef01234567…", raw: true },
    });
    // 父 handle 退化（无任何可用名段）→ label=null，屏渲染无名组头措辞。
    const nameless = buildImportTree(
      mapEntriesToImportRows(
        [omp("c", "2026-09-21T00:00:00.000Z", { parentHandleId: "///" })],
        () => null,
      ),
    );
    expect(nameless[0]).toMatchObject({ kind: "orphan-group", label: null });
  });

  it("ignores a self-parent link (standalone depth0, no orphan group)", () => {
    const rows = mapEntriesToImportRows(
      [omp("s", "2026-09-21T00:00:00.000Z", { parentHandleId: "s" })],
      () => null,
    );
    expect(treeShape(buildImportTree(rows))).toEqual(["s@0"]);
  });

  it("flattens to two levels: grandchild follows its nearest listed ancestor at depth1", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("a", "2026-09-20T00:00:00.000Z"),
        omp("b", "2026-09-21T00:00:00.000Z", { parentHandleId: "a" }),
        omp("c", "2026-09-22T00:00:00.000Z", { parentHandleId: "b" }),
      ],
      () => null,
    );
    expect(treeShape(buildImportTree(rows))).toEqual(["a@0", "b@1", "c@1"]);
  });

  it("matches only within the same provider (exact string, no cross-provider attach)", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("h", "2026-09-20T00:00:00.000Z"),
        entry({
          providerId: "claude",
          providerHandleId: "kid",
          parentHandleId: "h",
          lastActivityAt: "2026-09-21T00:00:00.000Z",
        }),
      ],
      () => null,
    );
    expect(treeShape(buildImportTree(rows))).toEqual(["group(h)@0", "kid@1", "h@0"]);
  });

  it("never drops rows: mutually-referencing parents resurface at depth0", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("x", "2026-09-21T00:00:00.000Z", { parentHandleId: "y" }),
        omp("y", "2026-09-20T00:00:00.000Z", { parentHandleId: "x" }),
      ],
      () => null,
    );
    const items = buildImportTree(rows);
    const handles = items.flatMap((item) =>
      item.kind === "session" ? [item.row.providerHandleId] : [],
    );
    expect(handles).toEqual(["x", "y"]); // 各恰好一次，无 depth2。
    expect(items.every((item) => item.depth <= 1)).toBe(true);
  });
});
