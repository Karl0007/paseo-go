// C10 导入屏纯逻辑 (DESIGN §8, card C10): 会话条目 → 行视图模型的映射、多选勾选态、
// 导入结果分类/汇总。无 React、无 RN —— 屏喂真实数据，vitest 喂 fixture。
// 标题/预览的取值规则复用官方 import-session-sheet-view-model（getSessionTitle /
// getPromptPreview），壳不重抄一份降级规则。

import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import { parseDateOrNull } from "@getpaseo/protocol/messages";
import { getPromptPreview, getSessionTitle } from "@/components/import-session-sheet-view-model";
import { formatCompactTimeAgo } from "@/utils/time";
import type { ChatOpenTarget } from "@/shell/chats/open-agent";
import { chatLastEventAtFromAgent } from "@/shell/chats/derive";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";

/** 一行的全部渲染事实；key 与官方聚合一致：`providerId:providerHandleId`。 */
export interface ImportRow {
  key: string;
  providerId: string;
  providerLabel: string;
  providerHandleId: string;
  cwd: string;
  /**
   * KI-4 裁定 → B8-IMPORT（F23，用户拍板）：标题=「第一条用户输入」——
   * firstPromptPreview → lastPromptPreview → 官方 getSessionTitle 的回退链。
   * 会话行版式里副标题承担「末条摘要」，标题再取末次输入会把同一段字在同一行
   * 里写两遍，所以取值端从末次改回首次（截断由屏的 numberOfLines 负责）。
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
  /**
   * 官方 getPromptPreview 结果（末次输入优先）=副标题的「末条摘要」段
   * （B8-IMPORT F23 起重新渲染；与标题同文时屏不重复展示，见 import.tsx）。
   */
  preview: string;
  /** 项目目录的短标签（官方 resolveDirectoryLabel + formatDirectoryLabel 结果，
   *  含 worktree detail）；未知目录为 null。 */
  folder: string | null;
  /**
   * B8-IMPORT F23: icon 色块的取字/配色输入=项目名。与会话行同源：命中在册项目
   * =项目名（=projectPlacement.projectName 同串），未命中=会话行同款 cwd 兜底名，
   * 于是同一个项目在对话 tab 与导入屏落在同一格色块上。null=屏未给归属信息。
   */
  projectName: string | null;
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
  /**
   * B5-IMPORT2: 服务端 `existing` 真值（请求带 includeExisting=true 时新 daemon
   * 才下发；已导入={agentId,archived:false}，已归档=archived:true）。
   * null=未标记（无匹配 / 旧 daemon）。它是「有没有导入过」的第一真值源（判定
   * 还认识 omp resume 链祖先，F17-4），但**不是「归档了没有」的真值源**——服务端
   * 只认 archivedAt，看不见壳归档 store 的本地归档，所以徽标态由
   * mergeImportBadgeFacts 合并两源（F23：已归档 > 已导入）。
   */
  existing: ImportAgentHandleFacts | null;
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

/** B8-IMPORT F23: 屏注入的目录解析结果——副标题的项目段 + icon 色块的项目名。 */
export interface ImportRowFolder {
  /** 副标题的项目段（官方 formatDirectoryLabel 结果，含 worktree detail）。 */
  label: string;
  /** icon 色块的取字/配色输入（与会话行同源的项目名/兜底名）。 */
  projectName: string;
}

/**
 * F23 标题对（单独成函数=标题口径只有一个地方说一次）：标题=第一条用户输入，
 * 退末次、退官方 getSessionTitle；官方 title 只在与新标题不同名时降级成 nameLabel
 * （子代理名 ReworkR45 那类不丢，同名则不在副标题里重复展示）。
 */
function importRowTitle(entry: FetchRecentProviderSessionEntry): {
  title: string;
  nameLabel: string | null;
} {
  const officialTitle = entry.title?.trim() || null;
  const title =
    entry.firstPromptPreview?.trim() || entry.lastPromptPreview?.trim() || getSessionTitle(entry);
  return { title, nameLabel: officialTitle && officialTitle !== title ? officialTitle : null };
}

/**
 * 一条条目 → 一行的渲染事实（`mapEntriesToImportRows` 的逐条半边，拆出来只为
 * 让「去重+排序」与「取值规则」各自可读；无副作用，屏看不见它）。
 */
function importRowFromEntry(
  entry: FetchRecentProviderSessionEntry,
  key: string,
  folderFor: (cwd: string) => ImportRowFolder | null,
): ImportRow {
  const parent = deriveImportParentLabel(entry);
  const folder = folderFor(entry.cwd);
  const { title, nameLabel } = importRowTitle(entry);
  return {
    key,
    providerId: entry.providerId,
    providerLabel: entry.providerLabel,
    providerHandleId: entry.providerHandleId,
    cwd: entry.cwd,
    title,
    nameLabel,
    parentHandleId: entry.parentHandleId?.trim() || null,
    preview: getPromptPreview(entry),
    folder: folder?.label ?? null,
    projectName: folder?.projectName ?? null,
    lastActivityAt: parseDateOrNull(entry.lastActivityAt)?.getTime() ?? null,
    parentLabel: parent?.text ?? null,
    parentIsRawId: parent?.raw ?? false,
    looksActive: entry.looksActive === true,
    existing: entry.existing ?? null,
  };
}

/**
 * 条目 → 行：按 key 去重（同一 handle 被两个 provider 报出时先到先得），再按最后
 * 动态倒序 — 与官方 aggregateSessionEntries 的语义一致，只是这里直接吃单响应。
 */
export function mapEntriesToImportRows(
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>,
  folderFor: (cwd: string) => ImportRowFolder | null,
): ImportRow[] {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (const entry of entries) {
    const key = importRowKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(importRowFromEntry(entry, key, folderFor));
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
 * B4-IMPORT（裁定 11）折叠坐标：`rootKey`=所属顶层单元键（父行=自身
 * handleKey，子行=祖先根行的 handleKey，孤儿成员=`orphan:` 组键），
 * `childCount`=该单元下 depth1 后代总数（0=无可折叠内容）。折叠判定只看
 * rootKey∈展开集，屏不需要第二份树结构。
 */
export type ImportTreeItem =
  | {
      kind: "session";
      row: ImportRow;
      depth: 0 | 1;
      rootKey: string;
      childCount: number;
    }
  | {
      kind: "orphan-group";
      key: string;
      label: ImportParentLabel | null;
      depth: 0;
      childCount: number;
    };

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
  // 返回 items 下标供 emitDescendants 之后回填 childCount；-1=emitted 闸（环防御）。
  const emitSession = (row: ImportRow, depth: 0 | 1, rootKey: string): number => {
    const handleKey = handleKeyOf(row);
    if (emitted.has(handleKey)) return -1;
    emitted.add(handleKey);
    items.push({ kind: "session", row, depth, rootKey, childCount: 0 });
    return items.length - 1;
  };
  // 两层展平：在册后代的 depth 恒为 1，紧随其最近的在册祖先。emitSession 的
  // emitted 闸返回 -1 时不再下钻——parent 互指的环在这里终止递归。
  // 返回值=实际发出的后代总数（含孙），供所属单元的 childCount 回填。
  const emitDescendants = (parent: ImportRow, rootKey: string): number => {
    const kids = childrenByParent.get(handleKeyOf(parent));
    if (!kids) return 0;
    kids.sort(importActivityDesc);
    let count = 0;
    for (const kid of kids) {
      if (emitSession(kid, 1, rootKey) >= 0) count += 1 + emitDescendants(kid, rootKey);
    }
    return count;
  };
  // 根 session 单元：depth0 自身 + 全部后代挂其自身 handleKey；后代发完回填计数。
  const emitRootUnit = (row: ImportRow): void => {
    const rootKey = handleKeyOf(row);
    const index = emitSession(row, 0, rootKey);
    if (index < 0) return;
    const item = items[index];
    if (item) item.childCount = emitDescendants(row, rootKey);
  };

  // 顶层序：独立/父行按自身活动时间倒序；孤儿组按组内最新活动参与同一时间序。
  interface TopLevel {
    at: number;
    emit: () => void;
  }
  const topLevel: TopLevel[] = roots.map((row) => ({
    at: row.lastActivityAt ?? 0,
    emit: () => emitRootUnit(row),
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
        const orphanKey = `orphan:${groupKey}`;
        items.push({ kind: "orphan-group", key: orphanKey, label, depth: 0, childCount: 0 });
        const groupIndex = items.length - 1;
        let count = 0;
        for (const member of members) {
          if (emitSession(member, 1, orphanKey) >= 0) {
            count += 1 + emitDescendants(member, orphanKey);
          }
        }
        const groupItem = items[groupIndex];
        if (groupItem) groupItem.childCount = count;
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
    emitRootUnit(row);
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

// ---------------------------------------------------------------------------
// B4-IMPORT（批次四 F6/F7，裁定 11/12）：默认折叠 + 已导入/已归档徽标。
// 折叠是「视图函数」：树（全量）+ 展开集 → 可见行；折叠态不持久化由屏保证
// （组件态=每次进屏的初值，切主机同拍作废）。徽标是「匹配函数」：行 handle
// ↔ agent 目录 persistence（字段实证见卡报告——服务端同款比较在
// server/agent/agent-storage.ts listByProviderSession：
// `persistence.sessionId===handle || persistence.nativeHandle===handle`，
// omp 恢复后 sessionId 会变运行期 id、nativeHandle 才保住 transcript 路径，
// 故两字段都要进索引）。匹配口径与服务端逐字节一致：provider 前缀 + 原串，
// 不做路径归一——比服务端更宽会把「服务端其实允许导入」的行禁勾选。
// B5-IMPORT2（F17）：新 daemon 起徽标真值改由响应 entry.existing 下发（请求
// includeExisting=true，服务端不再剔除已存在行；判定还覆盖 omp resume 链祖先
// ——壳侧索引看不见那一层）。本索引降级为旧 daemon / 竞态窗口的回退源。
// ---------------------------------------------------------------------------

/**
 * 树（全量）→ 可见行：depth1 项仅在其所属单元展开时保留；depth0 行与
 * orphan-group 组头恒可见（组头=折叠态下子会话的唯一入口）。
 */
export function applyImportTreeCollapse(
  items: ReadonlyArray<ImportTreeItem>,
  expandedRoots: ReadonlySet<string>,
): ImportTreeItem[] {
  return items.filter(
    (item) => item.kind !== "session" || item.depth === 0 || expandedRoots.has(item.rootKey),
  );
}

/**
 * 搜索/过滤态的强制展开集（裁定 11「命中子→所在父自动展开」）：C23 起过滤
 * 发生在条目层，能进树的 depth1 行都是命中者（或其父被过滤后成的孤儿组成员），
 * 所以「所有带子的单元」整体展开——收起它们等于把搜索结果藏起来。
 */
export function importTreeAutoExpandKeys(
  items: ReadonlyArray<ImportTreeItem>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.kind === "orphan-group") {
      if (item.childCount > 0) keys.add(item.key);
    } else if (item.depth === 0 && item.childCount > 0) {
      keys.add(item.rootKey);
    }
  }
  return keys;
}

/** 索引键与服务端 toProviderSessionHandleKey 同形：`provider\0handle`。 */
export function importAgentHandleKey(provider: string, handle: string): string {
  return `${provider}\0${handle}`;
}

/** 徽标匹配要读的 agent 目录最小面（屏从 session-store 的 Agent 投影而来）。 */
export interface ImportAgentHandleSource {
  id: string;
  provider: string;
  /** 服务端 archivedAt 或壳归档 store 命中，任一为真即「已归档」。 */
  archived: boolean;
  persistence: { sessionId: string; nativeHandle?: string | null } | null;
}

export interface ImportAgentHandleFacts {
  agentId: string;
  archived: boolean;
}

/**
 * agent 目录 → handle 索引：sessionId 与 nativeHandle 都进（服务端
 * listByProviderSession 同款双字段），键=agent.provider + handle。同一 handle
 * 被多个 agent 引用（归档存量 + 重新导入的活跃体）时**归档优先**（B8-IMPORT F23
 * 用户拍板：已归档 > 已导入）——徽标读的是这一格，活跃优先会把「导入过且已归档」
 * 的行标成「已导入」，点按也就跳不到归档段；跳转/高亮用的 agentId 随之落在归档体。
 */
export function buildImportAgentHandleIndex(
  agents: Iterable<ImportAgentHandleSource>,
): Map<string, ImportAgentHandleFacts> {
  const index = new Map<string, ImportAgentHandleFacts>();
  const add = (handle: string | null | undefined, agent: ImportAgentHandleSource): void => {
    if (!handle) return;
    const key = importAgentHandleKey(agent.provider, handle);
    const prev = index.get(key);
    if (!prev || (!prev.archived && agent.archived)) {
      index.set(key, { agentId: agent.id, archived: agent.archived });
    }
  };
  for (const agent of agents) {
    if (!agent.persistence) continue;
    add(agent.persistence.sessionId, agent);
    add(agent.persistence.nativeHandle, agent);
  }
  return index;
}

/** 行自身的徽标事实（无匹配=null=维持现状可勾选导入）。 */
export function classifyImportRowBadge(
  row: Pick<ImportRow, "providerId" | "providerHandleId">,
  index: ReadonlyMap<string, ImportAgentHandleFacts>,
): ImportAgentHandleFacts | null {
  return index.get(importAgentHandleKey(row.providerId, row.providerHandleId)) ?? null;
}

/**
 * 徽标事实两源合并（B8-IMPORT F23，用户拍板：已归档 > 已导入）。
 * 服务端 `existing` 回答「这个 handle 有没有对应的 agent」（还认识 omp resume 链
 * 祖先），壳侧目录索引回答「那个 agent 在壳里是不是被归档了」——两问不同，所以
 * 谁在场不能压住另一个：只要任一源说归档就是归档，两源都活跃才取服务端 agentId
 * （它认得的祖先体索引看不见）。null=两源都没命中=行维持现状可勾选。
 */
export function mergeImportBadgeFacts(
  server: ImportAgentHandleFacts | null | undefined,
  local: ImportAgentHandleFacts | null,
): ImportAgentHandleFacts | null {
  if (!server) return local;
  if (!local) return server;
  return local.archived && !server.archived ? local : server;
}

export interface ImportRowBadge {
  state: "imported" | "archived";
  /**
   * 跳转目标 agent；null=父行聚合徽标（自身无匹配，全部子已导入）——
   * 没有一个「该会话」可跳，屏退化为点行展开/收起。
   */
  agentId: string | null;
}

/**
 * 全树 → 行徽标表（键=row.key）。裁定 12：
 * - 行自身命中：活跃 agent=「已导入」，归档 agent=「已归档」；
 * - 父行聚合：自身无匹配且 childCount>0 且**全部后代都命中「已导入」**才标
 *   imported；部分命中或含归档子=不标（子各自标）；
 * - 自身命中优先于聚合（父自己是归档体就标「已归档」，不被子的 imported 盖掉）。
 * B5-IMPORT2：行自身事实来自服务端 `existing` + 壳侧目录索引两源。
 * B8-IMPORT F23：两源用 mergeImportBadgeFacts 合并（已归档 > 已导入）——旧口径
 * `existing ?? index` 在服务端报了活跃体时整个丢掉壳侧索引，而壳归档 store 的本地
 * 归档只存在于壳侧，于是「在对话 tab 归档过」的行仍标「已导入」（F23 的病灶）。
 */
export function buildImportRowBadgeMap(
  treeItems: ReadonlyArray<ImportTreeItem>,
  index: ReadonlyMap<string, ImportAgentHandleFacts>,
): Map<string, ImportRowBadge> {
  const badges = new Map<string, ImportRowBadge>();
  const hasServerFacts = treeItems.some(
    (item) => item.kind === "session" && item.row.existing !== null,
  );
  if (index.size === 0 && !hasServerFacts) return badges;
  const own = new Map<string, ImportAgentHandleFacts>();
  const importedChildren = new Map<string, number>();
  for (const item of treeItems) {
    if (item.kind !== "session") continue;
    const facts = mergeImportBadgeFacts(item.row.existing, classifyImportRowBadge(item.row, index));
    if (!facts) continue;
    own.set(item.row.key, facts);
    if (item.depth === 1 && !facts.archived) {
      importedChildren.set(item.rootKey, (importedChildren.get(item.rootKey) ?? 0) + 1);
    }
  }
  for (const item of treeItems) {
    if (item.kind !== "session") continue;
    const facts = own.get(item.row.key);
    if (facts) {
      badges.set(item.row.key, {
        state: facts.archived ? "archived" : "imported",
        agentId: facts.agentId,
      });
      continue;
    }
    if (item.depth === 0 && item.childCount > 0) {
      if (importedChildren.get(item.rootKey) === item.childCount) {
        badges.set(item.row.key, { state: "imported", agentId: null });
      }
    }
  }
  return badges;
}

/**
 * R4-06（开屏覆盖面收口）：徽标行跳转构造 C4 opener 目标所需的 agent 目录最小
 * 面（屏从 session-store 的 Agent 直读，COMPAT 口径同 composer findAgentFacts：
 * `ownership`/`externalLooksActive` 可缺，缺=pre-go.7 的 none/false）。
 */
export interface BadgeOpenAgentSource {
  workspaceId?: string | null;
  provider: string;
  labels?: Record<string, string> | null;
  lastActivityAt: Date;
  attentionTimestamp?: Date | null;
  ownership?: string | null;
  externalLooksActive?: boolean | null;
}

/**
 * 「已导入」徽标行主体点击的跳转目标（R4-06：走 createChatOpener 全链——R4 开屏
 * 门→C24 fork 门→markRead→recordVisit，与对话行同一条链，不再裸 navigate）。
 * 目录行=null（徽标渲染后目录被清/agent 已删的竞态）→ null=不开：没有任何一个
 * 「该会话」可进，静默比绕过守卫硬跳诚实。水位线取不到（R2-14 垃圾日期）=floor 0
 * （留点的姿势，同 notify 冷启 tap），绝不写假水位。
 */
export function buildBadgeOpenTarget(
  serverId: string,
  agentId: string,
  agent: BadgeOpenAgentSource | null | undefined,
): ChatOpenTarget | null {
  if (!agent) return null;
  return {
    key: `${serverId}:${agentId}`,
    serverId,
    agentId,
    workspaceId: agent.workspaceId ?? null,
    lastEventAt: chatLastEventAtFromAgent(agent) ?? 0,
    imported: isImportedProviderSession(agent),
    ownership: agent.ownership,
    externalLooksActive: agent.externalLooksActive,
    provider: agent.provider,
  };
}
