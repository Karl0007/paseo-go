// C10 验收 2：导入项映射/选择态纯逻辑单测。覆盖：key 形态、去重+倒序、标题/预览
// 回退、勾选幂等与取消、导入结果分类（daemon 的「already imported」幂等语义）。
// KI-4 验收 2 → B8-IMPORT F23 → B9-TITLE F30：标题=会话行同款项目串（同函数钉
// 例）、别名/子行决议、副标题预览/占位、nameLabel 回退矩阵、buildImportTree
// （父子嵌套/孤儿子组/自父防御/两层展平/顺序保持）。
// B4-IMPORT（裁定 11/12）：rootKey/childCount、默认折叠/搜索自动展开、
// handle↔persistence 徽标匹配（sessionId/nativeHandle 双字段、provider 域）与父行
// 聚合；F23 起两源合并口径=已归档 > 已导入（mergeImportBadgeFacts + 索引归档优先）。
import { describe, expect, it } from "vitest";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import {
  applyImportTreeCollapse,
  buildBadgeOpenTarget,
  buildImportAgentHandleIndex,
  buildImportRowBadgeMap,
  buildImportRowSubtitle,
  buildImportToastParts,
  buildImportTree,
  classifyImportError,
  classifyImportRowBadge,
  deriveImportParentLabel,
  deriveImportStatus,
  filterImportEntriesByQuery,
  importEntryMatchesQuery,
  importRowKey,
  importRowTitleSuffixes,
  importTreeAutoExpandKeys,
  mapEntriesToImportRows,
  mergeImportBadgeFacts,
  resolveImportRowTitle,
  summarizeImportAttempts,
  toggleRowSelection,
  type ImportAgentHandleSource,
  type ImportStatusInput,
  type ImportTreeItem,
} from "./rows";
import { buildChatRowTitle } from "@/shell/chats/row-title";

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
      // B9-TITLE：项目串走会话行同款格式化器（本例行无归属信息=空串）；
      // 原标题链降级 fallbackTitle；preview/firstUserMsg 是裸值（空串=缺席）。
      projectTitle: "",
      fallbackTitle: "fix the flaky suite",
      nameLabel: "Fix flaky test",
      parentHandleId: null,
      preview: "done",
      firstUserMsg: "fix the flaky suite",
      projectName: null,
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

  it("falls back through the title chain and maps project name into the title", () => {
    const [row] = mapEntriesToImportRows(
      [entry({ title: "   ", firstPromptPreview: "head only", lastPromptPreview: "tail only" })],
      (cwd) => (cwd === "C:/work/repo" ? "repo" : null),
    );
    // fallbackTitle 回退链=firstPromptPreview → lastPromptPreview → 官方
    // getSessionTitle；官方 title 只有空白 → nameLabel=null。钉具体值——
    // `length > 0` 对任何非空垃圾都成立（R2-23 假绿修复纪律）。
    expect(row.fallbackTitle).toBe("head only");
    expect(row.nameLabel).toBeNull();
    expect(row.preview).toBe("tail only");
    expect(row.firstUserMsg).toBe("head only");
    expect(row.projectName).toBe("repo");
    // B9-TITLE：cwd 尾段与项目同名 → worktree 段省略，标题=「repo」。
    expect(row.projectTitle).toBe("repo");
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

  // REVIEW-B8-13: 时间段格式化改走 shell/chats/use-wechat-time-label（与对话行
  // 同函数同输出，U7=B）——importRowTimeLabel 已删，行时间/null→占位的契约改钉
  // 在渲染面：import.test.tsx「两屏同一串」+ metaTimeUnknown 占位两例。
});

// KI-4 验收 2 → B8-IMPORT F23：标题回退矩阵（first→last→官方）+ nameLabel +
// buildImportTree（父子嵌套、孤儿子组聚合、自父防御、两层展平、顺序保持）。
describe("F23 title chain + nameLabel", () => {
  it("prefers firstPromptPreview, then lastPromptPreview, then the official title", () => {
    const [firstWins] = mapEntriesToImportRows(
      [entry({ title: "Official", firstPromptPreview: "F", lastPromptPreview: "L" })],
      () => null,
    );
    // B9-TITLE：原标题链降级为 fallbackTitle（子行无名时的标题兜底）；
    // 末条摘要走 preview（副标题段），同一行不再把同一段字写两遍。
    expect(firstWins.fallbackTitle).toBe("F");
    expect(firstWins.preview).toBe("L");
    // 官方 title 与新 title 不同 → 降级 nameLabel（子代理名 ReworkR45 不丢）。
    expect(firstWins.nameLabel).toBe("Official");

    const [firstNext] = mapEntriesToImportRows(
      [entry({ title: "Official", firstPromptPreview: " F ", lastPromptPreview: "   " })],
      () => null,
    );
    expect(firstNext.fallbackTitle).toBe("F"); // trim 后判空，纯空白不算末次输入。
    expect(firstNext.nameLabel).toBe("Official");

    const [officialLast] = mapEntriesToImportRows(
      [entry({ title: "Official", firstPromptPreview: null, lastPromptPreview: null })],
      () => null,
    );
    expect(officialLast.fallbackTitle).toBe("Official");
    // 与新 title 相同 → null（meta 行不重复展示同一个名字）。
    expect(officialLast.nameLabel).toBeNull(); // 与 fallbackTitle 相同 → 不重复展示。
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

// ---------------------------------------------------------------------------
// B9-TITLE（批次九 F30，用户口径「导入的标题和小字跟会话不一样」）：
// 标题=会话行同款项目串（同一 buildChatRowTitle，钉一例防两屏漂移）；已导入的
// 行别名优先（壳重命名=唯一「备注」源，D21 口径）；子行（└）=nameLabel；
// 副标题去项目段，预览为空退 firstUserMsg，全空退占位小字（小字恒在）。
// ---------------------------------------------------------------------------
describe("B9-TITLE: title = 会话行同款项目串（F30 裁定 1）", () => {
  it("钉例：同 cwd/同项目名的导入行标题与会话行格式化输出逐字相等", () => {
    const cwd = "C:/work/paseo-go/.paseo/worktrees/b9";
    const [row] = mapEntriesToImportRows([entry({ cwd })], () => "paseo-go");
    expect(row.projectTitle).toBe(buildChatRowTitle({ projectName: "paseo-go", cwd, note: null }));
    // 具体串：worktree 段与项目不同名 → 括号形态（会话行同款，非手抄第二份规则）。
    expect(row.projectTitle).toBe("paseo-go(b9)");
  });

  it("remote owner/repo 项目名只显短名，与会话行同规则", () => {
    const [row] = mapEntriesToImportRows(
      [entry({ cwd: "/home/dev/paseo" })],
      () => "getpaseo/paseo",
    );
    expect(row.projectTitle).toBe(
      buildChatRowTitle({ projectName: "getpaseo/paseo", cwd: "/home/dev/paseo", note: null }),
    );
    expect(row.projectTitle).toBe("paseo");
  });

  it("resolveImportRowTitle: 已导入行的别名压过项目串（两屏同一串）", () => {
    const row = { projectTitle: "paseo-go(b9)", nameLabel: null, fallbackTitle: "首个输入" };
    expect(resolveImportRowTitle(row, 0, "登录修复")).toBe("登录修复");
    expect(resolveImportRowTitle(row, 0, "  登录修复  ")).toBe("登录修复"); // trim 后判空。
    expect(resolveImportRowTitle(row, 0, "   ")).toBe("paseo-go(b9)"); // 纯空白=无别名。
    expect(resolveImportRowTitle(row, 0, null)).toBe("paseo-go(b9)");
  });
});

describe("B9-TITLE: 子行标题 = nameLabel（F30 裁定 2）", () => {
  it("有子代理名用名字，无名退 fallbackTitle，别名仍压过一切", () => {
    const row = { projectTitle: "paseo-go", nameLabel: "ReworkR45", fallbackTitle: "首个输入" };
    expect(resolveImportRowTitle(row, 1, null)).toBe("ReworkR45");
    expect(resolveImportRowTitle(row, 1, "登录修复")).toBe("登录修复");
    expect(resolveImportRowTitle({ ...row, nameLabel: null }, 1, null)).toBe("首个输入");
    expect(resolveImportRowTitle({ ...row, nameLabel: "  " }, 1, null)).toBe("首个输入");
  });

  it("屏未给归属信息（projectTitle 空串）时 depth0 也退 fallbackTitle", () => {
    const [row] = mapEntriesToImportRows([entry()], () => null);
    expect(row.projectTitle).toBe("");
    expect(resolveImportRowTitle(row, 0, null)).toBe("fix the flaky suite");
  });
});

describe("B9-TITLE: 副标题 = 预览 + 占位，项目段退役（F30 裁定 3/4）", () => {
  const labels = { emptyLabel: "暂无消息" };

  it("预览非空=裸预览（导入条目协议无角色字段，不加「我: 」前缀）", () => {
    expect(
      buildImportRowSubtitle(
        { preview: "已经修好了", firstUserMsg: "帮我修登录", nameLabel: null },
        { title: "paseo-go", ...labels },
      ),
    ).toBe("已经修好了");
  });

  it("预览为空 → firstUserMsg 兜底（搜索命中可读，裁定 4）", () => {
    expect(
      buildImportRowSubtitle(
        { preview: "", firstUserMsg: "帮我修登录", nameLabel: null },
        { title: "paseo-go", ...labels },
      ),
    ).toBe("帮我修登录");
  });

  it("空链 → 会话行同款占位小字（小字恒在，行高不塌）", () => {
    expect(
      buildImportRowSubtitle(
        { preview: "   ", firstUserMsg: "", nameLabel: null },
        { title: "paseo-go", ...labels },
      ),
    ).toBe("暂无消息");
  });

  it("nameLabel 留在副标题直到被提进标题；与标题同串不重复展示", () => {
    const row = { preview: "末条摘要", firstUserMsg: "首个输入", nameLabel: "ReworkR45" };
    // depth0：标题=项目串 → 名字仍在副标题（KI-4 名字不丢）。
    expect(buildImportRowSubtitle(row, { title: "paseo-go", ...labels })).toBe(
      "ReworkR45 · 末条摘要",
    );
    // depth1：名字就是标题 → 副标题不再重复一遍。
    expect(buildImportRowSubtitle(row, { title: "ReworkR45", ...labels })).toBe("末条摘要");
    // 别名接管标题后名字与标题不同串 → 同样保留（不变量不因别名让路）。
    expect(buildImportRowSubtitle(row, { title: "登录修复", ...labels })).toBe(
      "ReworkR45 · 末条摘要",
    );
  });

  it("唯一串就是标题 → 不写两遍，退占位", () => {
    expect(
      buildImportRowSubtitle(
        { preview: "ReworkR45", firstUserMsg: "ReworkR45", nameLabel: null },
        { title: "ReworkR45", ...labels },
      ),
    ).toBe("暂无消息");
  });
});

// ---------------------------------------------------------------------------
// REVIEW-B9-10（裁定 B）：可见集内标题碰撞才追加区分段。两例各守一头——无碰撞必须
// 逐字同串（F30「两屏同一串」不许被顺手改坏），有碰撞必须分开（同项目两条空链行在
// 勾选界面上只差右缘时间，勾错=重导一遍）。
// ---------------------------------------------------------------------------
describe("REVIEW-B9-10: 可见集内碰撞才追加区分段", () => {
  const row = (handle: string, projectTitle = "repo") => ({
    key: `omp:${handle}`,
    providerHandleId: handle,
    projectTitle,
  });
  const baseOf = (r: { projectTitle: string }) => r.projectTitle;

  it("无碰撞 → 空表：屏逐字保持 F30 那一串", () => {
    const rows = [row("omp-aaaa1111"), row("omp-bbbb2222", "other")];
    expect(importRowTitleSuffixes(rows, baseOf)).toEqual(new Map());
  });

  it("worktree 段已区分（repo(a) / repo(b)）→ 不重复追加", () => {
    const rows = [row("omp-aaaa1111", "repo(a)"), row("omp-bbbb2222", "repo(b)")];
    expect(importRowTitleSuffixes(rows, baseOf).size).toBe(0);
  });

  it("屏未给归属信息（base 空串）→ 不追加，免得造出「 · id」怪串", () => {
    const rows = [row("omp-aaaa1111", ""), row("omp-bbbb2222", "")];
    expect(importRowTitleSuffixes(rows, baseOf).size).toBe(0);
  });

  it("同项目两条空链 → 各得 handle 尾段，组合串不再同字", () => {
    const rows = [
      row("/home/u/.paseo/sessions/2f14e0a1-b2c3-4d5e-8f60-111122223333.jsonl"),
      row("/home/u/.paseo/sessions/9b7c6d5e-a1b2-4c3d-9e8f-444455556666.jsonl"),
    ];
    const suffixes = importRowTitleSuffixes(rows, baseOf);
    expect([...suffixes.values()]).toEqual(["22223333", "55556666"]);
    const titles = rows.map((r) => `repo · ${suffixes.get(r.key)}`);
    expect(new Set(titles).size).toBe(2);
  });

  it("尾 8 位仍相同 → 整组退 key（providerId:handle 唯一=追加的意义）", () => {
    const rows = [row("/s/prefix-1-aaaaaaaa.jsonl"), row("/s/prefix-2-aaaaaaaa.jsonl")];
    expect([...importRowTitleSuffixes(rows, baseOf).values()]).toEqual([
      "omp:/s/prefix-1-aaaaaaaa.jsonl",
      "omp:/s/prefix-2-aaaaaaaa.jsonl",
    ]);
  });

  it("判撞按传入的标题口径（别名口径）：项目串不同、别名相同 → 仍算碰撞", () => {
    const rows = [row("omp-aaaa1111", "repo(a)"), row("omp-bbbb2222", "repo(b)")];
    expect([...importRowTitleSuffixes(rows, () => "登录修复").values()]).toEqual([
      "aaaa1111",
      "bbbb2222",
    ]);
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

// ---------------------------------------------------------------------------
// B4-IMPORT（批次四 F6/F7，裁定 11/12）。
// ---------------------------------------------------------------------------

/** 折叠坐标断言：`handle@depth/n=childCount` / `group:N`。 */
function treeUnits(items: ImportTreeItem[]): string[] {
  return items.map((item) =>
    item.kind === "session"
      ? `${item.row.providerHandleId}@${item.depth}:${item.childCount}`
      : `group:${item.childCount}`,
  );
}

describe("buildImportTree collapse coordinates (B4-IMPORT)", () => {
  it("parent carries childCount over all descendants; every member shares rootKey", () => {
    // 孙两层展平后仍算父单元的子（折叠父=连孙一起收起）；册内后代紧随其在册父。
    const rows = mapEntriesToImportRows(
      [
        omp("p", "2026-09-20T00:00:00.000Z"),
        omp("c1", "2026-09-22T00:00:00.000Z", { parentHandleId: "p" }),
        omp("g", "2026-09-23T00:00:00.000Z", { parentHandleId: "c1" }),
      ],
      () => null,
    );
    const items = buildImportTree(rows);
    expect(treeUnits(items)).toEqual(["p@0:2", "c1@1:0", "g@1:0"]);
    const rootKeys = new Set(items.map((item) => (item.kind === "session" ? item.rootKey : "")));
    expect([...rootKeys]).toEqual(["omp:p"]);
  });

  it("orphan group counts its members at the group key; lone rows count zero", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("solo", "2026-09-25T00:00:00.000Z"),
        omp("k1", "2026-09-24T00:00:00.000Z", { parentHandleId: "ghost" }),
        omp("k2", "2026-09-23T00:00:00.000Z", { parentHandleId: "ghost" }),
      ],
      () => null,
    );
    const items = buildImportTree(rows);
    expect(treeUnits(items)).toEqual(["solo@0:0", "group:2", "k1@1:0", "k2@1:0"]);
    const members = items.filter(
      (item): item is Extract<ImportTreeItem, { kind: "session" }> =>
        item.kind === "session" && item.depth === 1,
    );
    expect(members.every((item) => item.rootKey === "orphan:omp:ghost")).toBe(true);
  });
});

describe("applyImportTreeCollapse + search auto-expand (裁定 11)", () => {
  const rows = mapEntriesToImportRows(
    [
      omp("p", "2026-09-20T00:00:00.000Z"),
      omp("c", "2026-09-21T00:00:00.000Z", { parentHandleId: "p" }),
      omp("solo", "2026-09-22T00:00:00.000Z"),
      omp("k", "2026-09-23T00:00:00.000Z", { parentHandleId: "ghost" }),
    ],
    () => null,
  );
  const items = buildImportTree(rows);

  it("empty expansion set = default collapsed: depth0 rows and group headers survive", () => {
    expect(treeShape(applyImportTreeCollapse(items, new Set()))).toEqual([
      "group(ghost)@0",
      "solo@0",
      "p@0",
    ]);
  });

  it("expanding a root reveals exactly its own descendants; orphan key reveals its group", () => {
    expect(treeShape(applyImportTreeCollapse(items, new Set(["omp:p"])))).toEqual([
      "group(ghost)@0",
      "solo@0",
      "p@0",
      "c@1",
    ]);
    expect(treeShape(applyImportTreeCollapse(items, new Set(["orphan:omp:ghost"])))).toEqual([
      "group(ghost)@0",
      "k@1",
      "solo@0",
      "p@0",
    ]);
  });

  it("auto-expand keys cover every unit with children (search hits must not hide)", () => {
    expect([...importTreeAutoExpandKeys(items)]).toEqual(["orphan:omp:ghost", "omp:p"]);
  });
});

describe("import agent handle index (裁定 12, 字段实证)", () => {
  function agent(overrides: Partial<ImportAgentHandleSource> = {}): ImportAgentHandleSource {
    return {
      id: "agent-1",
      provider: "codex",
      archived: false,
      persistence: { sessionId: "thread-1", nativeHandle: "thread-1" },
      ...overrides,
    };
  }
  const row = { providerId: "codex", providerHandleId: "thread-1" };

  it("matches sessionId and nativeHandle alike — the omp resume shape only keeps the path in nativeHandle", () => {
    // devd 实锤（4b0f1f3f）：恢复后 persistence.sessionId=运行期 UUID，
    // transcript 路径只剩在 nativeHandle——只比 sessionId 会漏标。
    const resumed = agent({
      provider: "omp",
      persistence: { sessionId: "01a0e029-uuid", nativeHandle: "C:\\sessions\\s.jsonl" },
    });
    const index = buildImportAgentHandleIndex([resumed]);
    expect(
      classifyImportRowBadge({ providerId: "omp", providerHandleId: "01a0e029-uuid" }, index),
    ).toMatchObject({ agentId: "agent-1" });
    expect(
      classifyImportRowBadge(
        { providerId: "omp", providerHandleId: "C:\\sessions\\s.jsonl" },
        index,
      ),
    ).toMatchObject({ agentId: "agent-1" });
  });

  it("scopes by provider and compares byte-exact (server listByProviderSession 同口径)", () => {
    const index = buildImportAgentHandleIndex([agent()]);
    expect(
      classifyImportRowBadge({ providerId: "claude", providerHandleId: "thread-1" }, index),
    ).toBeNull();
    expect(
      classifyImportRowBadge({ providerId: "codex", providerHandleId: "Thread-1" }, index),
    ).toBeNull();
  });

  it("skips persistence-less agents; archived wins over active for one handle (F23)", () => {
    // 同一 handle 被归档存量 + 重新导入的活跃体引用：徽标读这一格，F23 口径
    // 已归档 > 已导入——活跃优先会把「导入过且已归档」的行标成「已导入」，
    // 点按也就跳不到归档段（跳转/高亮的 agentId 必须落在归档体上）。
    const index = buildImportAgentHandleIndex([
      agent({ id: "mock", persistence: null }),
      agent({ id: "old", archived: true }),
      agent({ id: "new" }),
    ]);
    expect(classifyImportRowBadge(row, index)).toEqual({ agentId: "old", archived: true });
    // 反过来（活跃体先入索引）结论不变：优先级与入表顺序无关。
    const flipped = buildImportAgentHandleIndex([
      agent({ id: "new" }),
      agent({ id: "old", archived: true }),
    ]);
    expect(classifyImportRowBadge(row, flipped)).toEqual({ agentId: "old", archived: true });
  });

  it("archived-only hit reports archived facts (已归档 徽标位)", () => {
    const index = buildImportAgentHandleIndex([agent({ archived: true })]);
    expect(classifyImportRowBadge(row, index)).toEqual({ agentId: "agent-1", archived: true });
  });
});

// B8-IMPORT F23（用户拍板）：徽标优先级 已归档 > 已导入。病灶=旧口径
// `existing ?? index`：服务端只认 archivedAt，看不见壳归档 store 的本地归档，
// 于是「在对话 tab 归档过」的行仍标「已导入」，点按也跳不进归档段。
describe("badge priority: 已归档 > 已导入 (F23)", () => {
  it("merges the two fact sources with archived winning", () => {
    const active = { agentId: "srv", archived: false };
    const archived = { agentId: "local", archived: true };
    expect(mergeImportBadgeFacts(active, archived)).toEqual(archived);
    expect(mergeImportBadgeFacts(archived, active)).toEqual(archived);
    // 单源在场=原样；两源都活跃=服务端 agentId（它认得 omp resume 链祖先）。
    expect(mergeImportBadgeFacts(active, null)).toEqual(active);
    expect(mergeImportBadgeFacts(null, archived)).toEqual(archived);
    expect(mergeImportBadgeFacts(active, { agentId: "local", archived: false })).toEqual(active);
    expect(mergeImportBadgeFacts(null, null)).toBeNull();
  });

  it("archived + imported at once → only 已归档, and it jumps to the archived agent", () => {
    const rows = mapEntriesToImportRows(
      [omp("p", "2026-09-25T08:00:00.000Z", { existing: { agentId: "srv", archived: false } })],
      () => null,
    );
    // 壳侧目录：同一个 handle 命中一个被归档的 agent（壳归档 store 或服务端
    // archivedAt），服务端却报活跃体——合并后必须是「已归档」。
    const index = buildImportAgentHandleIndex([
      { id: "archived-agent", provider: "omp", archived: true, persistence: { sessionId: "p" } },
    ]);
    const badges = buildImportRowBadgeMap(buildImportTree(rows), index);
    expect(badges.get("omp:p")).toEqual({ state: "archived", agentId: "archived-agent" });
  });

  it("an archived child still breaks the parent's all-imported aggregation (裁定 12)", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("p", "2026-09-20T00:00:00.000Z"),
        omp("c1", "2026-09-22T00:00:00.000Z", { parentHandleId: "p" }),
      ],
      () => null,
    );
    const index = buildImportAgentHandleIndex([
      { id: "a1", provider: "omp", archived: true, persistence: { sessionId: "c1" } },
    ]);
    const badges = buildImportRowBadgeMap(buildImportTree(rows), index);
    expect(badges.get("omp:c1")).toEqual({ state: "archived", agentId: "a1" });
    expect(badges.has("omp:p")).toBe(false);
  });
});

describe("buildImportRowBadgeMap aggregation (裁定 12 父行)", () => {
  function indexed(handles: Array<[id: string, handle: string, archived?: boolean]>) {
    return buildImportAgentHandleIndex(
      handles.map(([id, handle, archived]) => ({
        id,
        provider: "omp",
        archived: archived ?? false,
        persistence: { sessionId: handle },
      })),
    );
  }
  const rows = mapEntriesToImportRows(
    [
      omp("p", "2026-09-20T00:00:00.000Z"),
      omp("c1", "2026-09-22T00:00:00.000Z", { parentHandleId: "p" }),
      omp("c2", "2026-09-21T00:00:00.000Z", { parentHandleId: "p" }),
    ],
    () => null,
  );
  const tree = buildImportTree(rows);

  it("all children imported → parent aggregated imported with no jump target", () => {
    const badges = buildImportRowBadgeMap(
      tree,
      indexed([
        ["a1", "c1"],
        ["a2", "c2"],
      ]),
    );
    expect(badges.get("omp:p")).toEqual({ state: "imported", agentId: null });
    expect(badges.get("omp:c1")).toEqual({ state: "imported", agentId: "a1" });
  });

  it("partial coverage marks nobody at the parent (children keep own badges)", () => {
    const badges = buildImportRowBadgeMap(tree, indexed([["a1", "c1"]]));
    expect(badges.has("omp:p")).toBe(false);
    expect(badges.get("omp:c1")?.state).toBe("imported");
  });

  it("an archived child breaks aggregation; the parent's own match outranks it", () => {
    const mixed = buildImportRowBadgeMap(
      tree,
      indexed([
        ["a1", "c1"],
        ["a2", "c2", true],
      ]),
    );
    expect(mixed.has("omp:p")).toBe(false);
    expect(mixed.get("omp:c2")).toEqual({ state: "archived", agentId: "a2" });
    const ownWins = buildImportRowBadgeMap(
      tree,
      indexed([
        ["ap", "p", true],
        ["a1", "c1"],
        ["a2", "c2"],
      ]),
    );
    expect(ownWins.get("omp:p")).toEqual({ state: "archived", agentId: "ap" });
  });

  it("empty index = no badges anywhere (目录未到货维持现状可勾选)", () => {
    expect(buildImportRowBadgeMap(tree, new Map()).size).toBe(0);
  });
});

// B5-IMPORT2（F17/D20）：徽标真值改由服务端 entry.existing 下发（请求
// includeExisting=true，新 daemon 不再剔除已存在行）；壳侧目录索引降级为
// 旧 daemon / 竞态窗口回退源。
describe("server existing truth (B5-IMPORT2)", () => {
  it("carries entry.existing onto the row; absent = null", () => {
    const [marked, plain] = mapEntriesToImportRows(
      [
        omp("m", "2026-09-25T08:00:00.000Z", { existing: { agentId: "a1", archived: false } }),
        omp("f", "2026-09-25T07:00:00.000Z"),
      ],
      () => null,
    );
    expect(marked.existing).toEqual({ agentId: "a1", archived: false });
    expect(plain.existing).toBeNull();
  });

  it("server facts win over a conflicting shell index claim", () => {
    const rows = mapEntriesToImportRows(
      [omp("p", "2026-09-25T08:00:00.000Z", { existing: { agentId: "srv", archived: true } })],
      () => null,
    );
    const index = buildImportAgentHandleIndex([
      {
        id: "stale",
        provider: "omp",
        archived: false,
        persistence: { sessionId: "p" },
      },
    ]);
    const badges = buildImportRowBadgeMap(buildImportTree(rows), index);
    expect(badges.get("omp:p")).toEqual({ state: "archived", agentId: "srv" });
  });

  it("server facts badge without any shell directory index (old fallback empty)", () => {
    const rows = mapEntriesToImportRows(
      [
        omp("a", "2026-09-25T08:00:00.000Z", { existing: { agentId: "x", archived: false } }),
        omp("b", "2026-09-25T07:00:00.000Z", { existing: { agentId: "y", archived: true } }),
        omp("c", "2026-09-25T06:00:00.000Z"),
      ],
      () => null,
    );
    const badges = buildImportRowBadgeMap(buildImportTree(rows), new Map());
    expect(badges.get("omp:a")).toEqual({ state: "imported", agentId: "x" });
    expect(badges.get("omp:b")).toEqual({ state: "archived", agentId: "y" });
    expect(badges.has("omp:c")).toBe(false);
  });

  it("rows without server facts still fall back to the shell index (旧 daemon)", () => {
    const rows = mapEntriesToImportRows([omp("legacy", "2026-09-25T08:00:00.000Z")], () => null);
    const index = buildImportAgentHandleIndex([
      {
        id: "old-daemon-agent",
        provider: "omp",
        archived: false,
        persistence: { sessionId: "legacy" },
      },
    ]);
    const badges = buildImportRowBadgeMap(buildImportTree(rows), index);
    expect(badges.get("omp:legacy")).toEqual({ state: "imported", agentId: "old-daemon-agent" });
  });
});

// R4-06（开屏覆盖面收口）：徽标跳转的 opener 目标构造。链本身（R4 门→fork 门→
// markRead→recordVisit→navigate）由 open-agent.test 钉死；这里钉的是「喂给链的
// 事实」——分级门的三个输入必须原样来自目录行，缺了=pre-go.7 静默口径。
describe("buildBadgeOpenTarget (R4-06)", () => {
  const STAMP = Date.parse("2026-09-28T10:00:00.000Z");
  function agentSource(
    overrides: Partial<{
      workspaceId: string | null;
      provider: string;
      labels: Record<string, string> | null;
      lastActivityAt: Date;
      attentionTimestamp: Date | null;
      ownership: string | null;
      externalLooksActive: boolean | null;
    }> = {},
  ) {
    return {
      workspaceId: "ws-1",
      provider: "omp",
      labels: {},
      lastActivityAt: new Date(STAMP),
      attentionTimestamp: new Date(STAMP - 60_000),
      ownership: "external" as string | null,
      externalLooksActive: true,
      ...overrides,
    };
  }

  it("maps the directory row into an open target (F37: no gate facts ride it)", () => {
    const target = buildBadgeOpenTarget(
      "srv-1",
      "agent-9",
      agentSource({ labels: { "paseo.imported-provider-session": "true" } }),
    );
    expect(target).toEqual({
      key: "srv-1:agent-9",
      serverId: "srv-1",
      agentId: "agent-9",
      workspaceId: "ws-1",
      // 水位=max(活动, 求 attention)——F4 同族口径。
      lastEventAt: STAMP,
    });
  });

  it("a missing directory row opens nothing (竞态=静默，绝不裸 navigate 绕守卫)", () => {
    expect(buildBadgeOpenTarget("srv-1", "agent-9", undefined)).toBeNull();
    expect(buildBadgeOpenTarget("srv-1", "agent-9", null)).toBeNull();
  });

  it("COMPAT: pre-go.7 row (ownership pair absent) still maps (no gate reads it)", () => {
    const target = buildBadgeOpenTarget(
      "srv-1",
      "agent-9",
      agentSource({ ownership: undefined, externalLooksActive: undefined, labels: undefined }),
    );
    expect(target?.key).toBe("srv-1:agent-9");
  });

  it("R2-14: garbage host dates floor the watermark to 0, never NaN/fake", () => {
    const target = buildBadgeOpenTarget(
      "srv-1",
      "agent-9",
      agentSource({ lastActivityAt: new Date(NaN), attentionTimestamp: null }),
    );
    expect(target?.lastEventAt).toBe(0);
  });
});
