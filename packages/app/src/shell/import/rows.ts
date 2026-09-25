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
    });
  }
  rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return rows;
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
