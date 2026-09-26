// C10 导入屏纯逻辑 (DESIGN §8, card C10): 会话条目 → 行视图模型的映射、多选勾选态、
// 导入结果分类/汇总。无 React、无 RN —— 屏喂真实数据，vitest 喂 fixture。
// 标题/预览的取值规则复用官方 import-session-sheet-view-model（getSessionTitle /
// getPromptPreview），壳不重抄一份降级规则。

import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import { getPromptPreview, getSessionTitle } from "@/components/import-session-sheet-view-model";

/** 一行的全部渲染事实；key 与官方聚合一致：`providerId:providerHandleId`。 */
export interface ImportRow {
  key: string;
  providerId: string;
  providerLabel: string;
  providerHandleId: string;
  cwd: string;
  title: string;
  preview: string;
  /** 项目目录的短标签（官方 resolveDirectoryLabel 结果）；未知目录为 null。 */
  folder: string | null;
  lastActivityAt: number;
  /**
   * C25 父链副标题的父名段：parentTitle 优先，缺席时取 parentHandleId 尾段
   * （omp=父 transcript 路径的文件名去扩展名）；两者都无（claude/codex 或旧
   * daemon 字段缺席）= null=不渲染。
   */
  parentLabel: string | null;
  /** C25「可能活跃」= descriptor looksActive===true；缺席/false 都不渲染。 */
  looksActive: boolean;
}

/**
 * C25 父链副标题的父名段（纯函数，屏只负责 t() 包裹措辞）。
 * parentTitle（含纯空白判定）优先；否则取 parentHandleId 尾段——omp 的
 * handleId 是父 transcript 路径（`\` 或 `/` 分隔），尾段再去掉 `.jsonl`
 * 扩展名；父未进扫描窗时 daemon 只给原始父 id=同样走尾段规则。
 */
export function deriveImportParentLabel(
  entry: Pick<FetchRecentProviderSessionEntry, "parentHandleId" | "parentTitle">,
): string | null {
  const title = entry.parentTitle?.trim();
  if (title) return title;
  const handle = entry.parentHandleId?.trim();
  if (!handle) return null;
  const segments = handle.split(/[/\\]+/).filter(Boolean);
  const tail = segments[segments.length - 1];
  if (!tail) return null;
  const stem = tail.toLowerCase().endsWith(".jsonl") ? tail.slice(0, -".jsonl".length) : tail;
  return stem.length > 0 ? stem : null;
}

export function importRowKey(
  entry: Pick<FetchRecentProviderSessionEntry, "providerId" | "providerHandleId">,
): string {
  return `${entry.providerId}:${entry.providerHandleId}`;
}

/**
 * 条目 → 行：按 key 去重（同一 handle 被两个 provider 报出时先到先得），再按最后
 * 动态倒序 — 与官方 aggregateSessionEntries 的语义一致，只是这里直接吃单响应。
 */
export function mapEntriesToImportRows(
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>,
  folderFor: (cwd: string) => string | null,
): ImportRow[] {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (const entry of entries) {
    const key = importRowKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      providerId: entry.providerId,
      providerLabel: entry.providerLabel,
      providerHandleId: entry.providerHandleId,
      cwd: entry.cwd,
      title: getSessionTitle(entry),
      preview: getPromptPreview(entry),
      folder: folderFor(entry.cwd),
      lastActivityAt: new Date(entry.lastActivityAt).getTime(),
      parentLabel: deriveImportParentLabel(entry),
      looksActive: entry.looksActive === true,
    });
  }
  rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return rows;
}

/**
 * C23 旧 daemon 降级：capability `importSessionSearch`=false 时 query 不进 RPC，
 * 改在已载条目上做小写子串过滤。haystack 对齐服务端检索面：title /
 * firstPromptPreview / lastPromptPreview / cwd（null 字段跳过）。
 * `normalizedQuery` 来自 normalizeSearchQuery；空 query 恒真（restore-on-clear）。
 */
export function importEntryMatchesQuery(
  entry: FetchRecentProviderSessionEntry,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;
  return [entry.title, entry.firstPromptPreview, entry.lastPromptPreview, entry.cwd].some(
    (field) => typeof field === "string" && field.toLowerCase().includes(normalizedQuery),
  );
}

/** 已载条目的本地过滤（保序）；空 query 原样返回同一数组语义的新数组。 */
export function filterImportEntriesByQuery(
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>,
  normalizedQuery: string,
): FetchRecentProviderSessionEntry[] {
  if (normalizedQuery.length === 0) return [...entries];
  return entries.filter((entry) => importEntryMatchesQuery(entry, normalizedQuery));
}

/** 勾选/取消勾选；重复勾选不产生重复项（幂等）。 */
export function toggleRowSelection(selected: readonly string[], key: string): string[] {
  return selected.includes(key)
    ? selected.filter((candidate) => candidate !== key)
    : [...selected, key];
}

/** 一次导入尝试的结果（屏逐条 await 后收集）。 */
export interface ImportAttempt {
  key: string;
  ok: boolean;
  /** ok=false 时：daemon 报「已导入」→ 幂等提示而非失败。 */
  alreadyImported?: boolean;
}

export interface ImportSummary {
  imported: number;
  alreadyImported: number;
  failed: number;
}

export function summarizeImportAttempts(attempts: ReadonlyArray<ImportAttempt>): ImportSummary {
  let imported = 0;
  let alreadyImported = 0;
  let failed = 0;
  for (const attempt of attempts) {
    if (attempt.ok) imported += 1;
    else if (attempt.alreadyImported) alreadyImported += 1;
    else failed += 1;
  }
  return { imported, alreadyImported, failed };
}

/**
 * daemon 对重复导入抛 `Provider session is already imported: <handle>`
 * (server/agent/import-sessions.ts)。其余异常照实算失败。
 */
export function classifyImportError(error: unknown): { alreadyImported: boolean; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { alreadyImported: /already imported/i.test(message), message };
}

/** 屏体状态行的全部输入；输出 i18n key+params，屏只负责 t()。 */
export interface ImportStatusInput {
  hostCount: number;
  hasServerId: boolean;
  supportsSnapshot: boolean;
  hasClient: boolean;
  listStatus: "loading" | "ready" | "error";
  errorMessage?: string | null;
  rowCount: number;
  alreadyImportedCount: number;
  hasNoImportableProviders: boolean;
  /** C23: 搜索态——非空 query（服务端或本地降级过滤均计入）。 */
  hasQuery?: boolean;
  /** C23: true=过滤发生在客户端（旧 daemon），空态文案据此区分。 */
  queryRunsLocally?: boolean;
}

/** 状态行判定（优先级自上而下）：无主机 → 未选 host → 旧 daemon → 未连接 → 加载失败 → 无 provider → 加载 → 空态。 */
export function deriveImportStatus(
  input: ImportStatusInput,
): { key: string; params?: Record<string, string | number> } | null {
  if (input.hostCount === 0) return { key: "import.noHostsBody" };
  if (!input.hasServerId) return { key: "import.pickHost" };
  if (!input.supportsSnapshot) return { key: "import.status.updateHost" };
  if (!input.hasClient) return { key: "import.status.connectHost" };
  if (input.listStatus === "error")
    return { key: "import.status.failed", params: { message: input.errorMessage ?? "" } };
  if (input.hasNoImportableProviders) return { key: "import.status.noProviders" };
  if (input.listStatus === "loading" && input.rowCount === 0)
    return { key: "import.status.loading" };
  if (input.listStatus === "ready" && input.rowCount === 0) {
    // C23: 搜索无结果优先于「已隐藏已导入」——查询态下那句是噪音；再按降级
    // 开关区分「服务端无结果」与「本地过滤无结果（只覆盖已载条目）」。
    if (input.hasQuery) {
      return { key: input.queryRunsLocally ? "import.searchEmptyLocal" : "import.searchEmpty" };
    }
    return input.alreadyImportedCount > 0
      ? { key: "import.alreadyHidden", params: { count: input.alreadyImportedCount } }
      : { key: "import.empty" };
  }
  return null;
}

/** 导入结果 toast 的分段（屏逐段 t() 后用 · 拼接）。 */
export function buildImportToastParts(
  summary: ImportSummary,
): Array<{ key: "imported" | "already" | "failed"; count: number }> {
  const parts: Array<{ key: "imported" | "already" | "failed"; count: number }> = [];
  if (summary.imported > 0) parts.push({ key: "imported", count: summary.imported });
  if (summary.alreadyImported > 0) parts.push({ key: "already", count: summary.alreadyImported });
  if (summary.failed > 0) parts.push({ key: "failed", count: summary.failed });
  return parts;
}
