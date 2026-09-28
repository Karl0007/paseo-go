// C10 导入屏纯逻辑 (DESIGN §8, card C10): 会话条目 → 行视图模型的映射、多选勾选态、
// 导入结果分类/汇总。无 React、无 RN —— 屏喂真实数据，vitest 喂 fixture。
// 标题/预览的取值规则复用官方 import-session-sheet-view-model（getSessionTitle /
// getPromptPreview），壳不重抄一份降级规则。

import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import { parseDateOrNull } from "@getpaseo/protocol/messages";
import { getPromptPreview, getSessionTitle } from "@/components/import-session-sheet-view-model";
import { formatCompactTimeAgo } from "@/utils/time";

/** 一行的全部渲染事实；key 与官方聚合一致：`providerId:providerHandleId`。 */
export interface ImportRow {
  key: string;
  providerId: string;
  providerLabel: string;
  providerHandleId: string;
  cwd: string;
  /**
   * KI-4 裁定：标题=「最后一次用户输入」——lastPromptPreview → firstPromptPreview
   * → 官方 getSessionTitle 的回退链（末次输入优先；全空才退回官方标题规则）。
   */
  title: string;
  /**
   * KI-4: 官方 title（子代理名 ReworkR45 这类）；与新 title 相同或缺席时为
   * null——有值才降级渲染进 meta 行，名字不丢。
   */
  nameLabel: string | null;
  /**
   * KI-4: 父 handle（trim 后；空/缺席=null）。buildImportTree 的分组键：
   * `child.parentHandleId === parent.providerHandleId`（同 provider 精确串匹配）。
   */
  parentHandleId: string | null;
  /** 官方 getPromptPreview 结果；KI-4 后 cell 不再渲染（title 即末次输入，同文
   *  重复），字段保留在模型里（KI-5 契约：不碰它）。 */
  preview: string;
  /** 项目目录的短标签（官方 resolveDirectoryLabel 结果）；未知目录为 null。 */
  folder: string | null;
  /** R2-14: epoch ms of the host-reported activity; null = the host sent a
   *  non-date string (the wire field is a bare z.string()). Rows with null
   *  sort last and render the placeholder time segment, never "Invalid Date". */
  lastActivityAt: number | null;
  /**
   * C25 父链副标题的父名段：parentTitle 优先，缺席时取 parentHandleId 尾段
   * （omp=父 transcript 路径的文件名去扩展名）；两者都无（claude/codex 或旧
   * daemon 字段缺席）= null=不渲染。KI-4 后 session 行不再渲染副标题（树形结构
   * 取代），字段保留供 orphan-group 组头 label 复用。
   */
  parentLabel: string | null;
  /** R2-18: true = parentLabel 是无分隔符的原始父 id（非名），组头走「源:」措辞。 */
  parentIsRawId: boolean;
  /** C25「可能活跃」= descriptor looksActive===true；缺席/false 都不渲染。 */
  looksActive: boolean;
}

/** 裸 id（非路径形态）的展示截断长度（R2-18：整串不是名字，截断即可辨认来源）。 */
const RAW_PARENT_ID_MAX = 16;

export interface ImportParentLabel {
  /** 展示文本：parentTitle 原样；路径形态=尾段去 .jsonl；裸 id=截断串。 */
  text: string;
  /** true = daemon 只给了无分隔符的原始父 id（非名），屏改用「源:」措辞渲染。 */
  raw: boolean;
}

/**
 * C25 父链副标题的父名段（纯函数，屏只负责 t() 包裹措辞）。
 * parentTitle（含纯空白判定）优先；否则取 parentHandleId 尾段——omp 的
 * handleId 是父 transcript 路径（`\` 或 `/` 分隔），尾段再去掉 `.jsonl`
 * 扩展名。**R2-18**：无分隔符又无扩展名的裸 id 不冒充父名——标 raw=true，
 * 由屏加「源:」前缀并截断展示，避免原始 id 被当成会话标题。
 */
export function deriveImportParentLabel(
  entry: Pick<FetchRecentProviderSessionEntry, "parentHandleId" | "parentTitle">,
): ImportParentLabel | null {
  const title = entry.parentTitle?.trim();
  if (title) return { text: title, raw: false };
  const handle = entry.parentHandleId?.trim();
  if (!handle) return null;
  const segments = handle.split(/[/\\]+/).filter(Boolean);
  const tail = segments[segments.length - 1];
  if (!tail) return null;
  const hasJsonl = tail.toLowerCase().endsWith(".jsonl");
  const stem = hasJsonl ? tail.slice(0, -".jsonl".length) : tail;
  if (stem.length === 0) return null;
  // 路径形态（有分隔符）或文件名形态（带 .jsonl）= 尾段当父名。
  if (segments.length > 1 || hasJsonl) return { text: stem, raw: false };
  // 非路径形态（无分隔符的裸 id）：截断 + raw 标记，屏加「源:」。
  const text = stem.length > RAW_PARENT_ID_MAX ? `${stem.slice(0, RAW_PARENT_ID_MAX)}…` : stem;
  return { text, raw: true };
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
    const parent = deriveImportParentLabel(entry);
    // KI-4 裁定 2：标题=末次用户输入；全空才退回官方标题规则。nameLabel 只在
    // 官方 title 存在且与新 title 不同才有值（同名不重复展示）。
    const officialTitle = entry.title?.trim() || null;
    const title =
      entry.lastPromptPreview?.trim() || entry.firstPromptPreview?.trim() || getSessionTitle(entry);
    rows.push({
      key,
      providerId: entry.providerId,
      providerLabel: entry.providerLabel,
      providerHandleId: entry.providerHandleId,
      cwd: entry.cwd,
      title,
      nameLabel: officialTitle && officialTitle !== title ? officialTitle : null,
      parentHandleId: entry.parentHandleId?.trim() || null,
      preview: getPromptPreview(entry),
      folder: folderFor(entry.cwd),
      lastActivityAt: parseDateOrNull(entry.lastActivityAt)?.getTime() ?? null,
      parentLabel: parent?.text ?? null,
      parentIsRawId: parent?.raw ?? false,
      looksActive: entry.looksActive === true,
    });
  }
  // R2-14: unknown dates (null) sink below every trustworthy one (0=epoch 序).
  rows.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  return rows;
}

/**
 * KI-4 裁定 1：父子任务树形展示（不是「至少连续排列」）。树项两种：
 * - session：可勾选会话行；depth 0=父/独立行，1=子行（屏渲染左缩进 + `└`）。
 * - orphan-group：父不在列表的孤儿子集共享的组头（不可点、不可勾选）；
 *   label 复用 deriveImportParentLabel 三态（parentTitle→尾段→raw 截断），
 *   三态全空（如 parentHandleId="///"）= null，屏渲染无名组头措辞。
 */
export type ImportTreeItem =
  | { kind: "session"; row: ImportRow; depth: 0 | 1 }
  | { kind: "orphan-group"; key: string; label: ImportParentLabel | null; depth: 0 };

/** 与 mapEntriesToImportRows 同一时间序：新在上，null 日期沉底（0=epoch 序）。 */
const importActivityDesc = (a: ImportRow, b: ImportRow): number =>
  (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);

/**
 * 行 → 树（纯函数，勾选语义不变：每个 session 项独立，组头不可选）。
 * 规则（卡内算法）：
 * - 匹配：`child.parentHandleId === parent.providerHandleId`，同 provider 精确串；
 * - 父在列表 → 父 depth0，子按时间倒序紧跟其后 depth1；
 * - 父不在列表 → 同 parentHandleId 的孤儿子集共享一个 orphan-group 头，
 *   组位置=组内最新活动时间序；
 * - 无 parentHandleId → 独立 depth0；
 * - 防御：自父（parentHandleId===providerHandleId）忽略父链；只铺两层——孙挂
 *   最近在册祖先（depth1 继续跟随其在册父紧随其后）；parent 互指成环的行不会被
 *   吞掉（末轮以 depth0 补发，每行恰好出现一次）。
 */
export function buildImportTree(rows: ReadonlyArray<ImportRow>): ImportTreeItem[] {
  const handleKeyOf = (row: ImportRow): string => `${row.providerId}:${row.providerHandleId}`;
  const byHandle = new Map<string, ImportRow>();
  for (const row of rows) {
    const handleKey = handleKeyOf(row);
    if (!byHandle.has(handleKey)) byHandle.set(handleKey, row);
  }

  const childrenByParent = new Map<string, ImportRow[]>();
  const orphanGroups = new Map<string, ImportRow[]>();
  const roots: ImportRow[] = [];
  for (const row of rows) {
    // 重复 handle 与映射层同纪律：先到先得，后来者不进树。
    if (byHandle.get(handleKeyOf(row)) !== row) continue;
    // 自父防御：指向自己的父链按无父处理（独立 depth0，不进孤儿子组）。
    const parentHandle =
      row.parentHandleId && row.parentHandleId !== row.providerHandleId ? row.parentHandleId : null;
    const parent = parentHandle
      ? (byHandle.get(`${row.providerId}:${parentHandle}`) ?? null)
      : null;
    if (parent) {
      const parentKey = handleKeyOf(parent);
      const kids = childrenByParent.get(parentKey);
      if (kids) kids.push(row);
      else childrenByParent.set(parentKey, [row]);
    } else if (parentHandle) {
      const groupKey = `${row.providerId}:${parentHandle}`;
      const members = orphanGroups.get(groupKey);
      if (members) members.push(row);
      else orphanGroups.set(groupKey, [row]);
    } else {
      roots.push(row);
    }
  }

  const items: ImportTreeItem[] = [];
  const emitted = new Set<string>();
  const emitSession = (row: ImportRow, depth: 0 | 1): boolean => {
    const handleKey = handleKeyOf(row);
    if (emitted.has(handleKey)) return false;
    emitted.add(handleKey);
    items.push({ kind: "session", row, depth });
    return true;
  };
  // 两层展平：在册后代的 depth 恒为 1，紧随其最近的在册祖先。emitSession 的
  // emitted 闸返回 false 时不再下钻——parent 互指的环在这里终止递归。
  const emitDescendants = (parent: ImportRow): void => {
    const kids = childrenByParent.get(handleKeyOf(parent));
    if (!kids) return;
    kids.sort(importActivityDesc);
    for (const kid of kids) {
      if (emitSession(kid, 1)) emitDescendants(kid);
    }
  };

  // 顶层序：独立/父行按自身活动时间倒序；孤儿组按组内最新活动参与同一时间序。
  interface TopLevel {
    at: number;
    emit: () => void;
  }
  const topLevel: TopLevel[] = roots.map((row) => ({
    at: row.lastActivityAt ?? 0,
    emit: () => {
      emitSession(row, 0);
      emitDescendants(row);
    },
  }));
  for (const [groupKey, members] of orphanGroups) {
    members.sort(importActivityDesc);
    const freshest = members[0];
    topLevel.push({
      at: freshest?.lastActivityAt ?? 0,
      emit: () => {
        const label =
          freshest && freshest.parentLabel !== null
            ? { text: freshest.parentLabel, raw: freshest.parentIsRawId }
            : null;
        items.push({ kind: "orphan-group", key: `orphan:${groupKey}`, label, depth: 0 });
        for (const member of members) {
          emitSession(member, 1);
          emitDescendants(member);
        }
      },
    });
  }
  // Array#sort 稳定：同时间戳保持入参（=映射层时间序）相对次序。
  topLevel.sort((a, b) => b.at - a.at);
  for (const unit of topLevel) unit.emit();

  // 环防御：互指父链的行不属于任何顶层单元，按入参序以 depth0 补发，
  // 保证「每行恰好出现一次」。
  for (const row of rows) {
    if (emitted.has(handleKeyOf(row))) continue;
    emitSession(row, 0);
    emitDescendants(row);
  }
  return items;
}

/**
 * 行 meta 的时间段（纯函数，屏只负责占位措辞的 t() 包裹）。
 * R2-14: null = 主机日期串不可解析 → 屏渲染占位，绝不让
 * formatCompactTimeAgo(new Date(NaN)) 吐出 "Invalid Date NaN"。
 */
export function importRowTimeLabel(
  lastActivityAt: number | null,
  now: Date = new Date(),
): string | null {
  return lastActivityAt === null ? null : formatCompactTimeAgo(new Date(lastActivityAt), now);
}

/**
 * 服务端真值（server/agent/agent-manager.ts matchesImportableSessionQuery）：
 * cwd 进 haystack 的是 basename(cwd.replaceAll("\\","/"))，不是整条路径。
 * node basename 语义：先剥尾分隔符，再取最后一个 "/" 段。
 */
function cwdBasenameOf(cwd: string): string {
  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

/**
 * C23 旧 daemon 降级：capability `importSessionSearch`=false 时 query 不进 RPC，
 * 改在已载条目上做小写子串过滤。haystack 与服务端检索面同源（R2-17 修正——此前
 * 整条 cwd 入串，父目录关键词会命中服务端永不返回的行）：title /
 * firstPromptPreview / lastPromptPreview / basename(cwd)（null 字段跳过）。
 * `normalizedQuery` 来自 normalizeSearchQuery；空 query 恒真（restore-on-clear）。
 */
export function importEntryMatchesQuery(
  entry: FetchRecentProviderSessionEntry,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;
  return [
    entry.title,
    entry.firstPromptPreview,
    entry.lastPromptPreview,
    cwdBasenameOf(entry.cwd),
  ].some((field) => typeof field === "string" && field.toLowerCase().includes(normalizedQuery));
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
