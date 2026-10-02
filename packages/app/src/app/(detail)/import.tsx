// 会话导入屏 (card C10, DESIGN §8): ＋菜单 →「导入会话」进入本屏。流程：
// 选 host（KI-5：挂载单 host 自动选中免弹；顶栏主机 chip 点击恒弹
// ShellHostPickerSheet，含「添加主机」行）→ 列可导入会话（标题/时间/项目，
// 数据源 daemon `fetch_recent_provider_sessions`）→ 勾选 → 导入按钮（逐条进度
// n/m）→ 成功 toast → 返回对话列表，新条目出现后点开即完整 timeline（C4
// opener）。B4-IMPORT（批次四 F6/F7 裁定 11/12）：树默认折叠子会话（父行
// chevron+子计数，点 chevron 展开；搜索/过滤态强制展开；折叠态不持久化），
// 行标「已导入/已归档」灰徽标+勾选禁用+点主体跳转。B5-IMPORT2（F17/D20）：
// 请求带 includeExisting、limit 提至 200——新 daemon 不再剔除已存在行，徽标
// 真值=响应 entry.existing（服务端判定，含 omp resume 链祖先）；壳侧目录索引
// 降级为旧 daemon/竞态窗口回退。重复导入按 daemon 的「already imported」错误归类
// 为幂等提示而非失败。状态判定/行映射/树/折叠/徽标/勾选/结果分类都在
// @/shell/import/rows（纯逻辑，单测覆盖），屏只剩数据接线与渲染。KI-9 起本屏
// 是 (detail) 根栈 push：返回按钮=router.back 真弹栈（与硬件/手势返回同款），
// canGoBack 兑底 replace 回对话。
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RotateCw,
  Search,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  IDENTITY_COLOR_NAMES,
  IDENTITY_GLYPH_COLOR,
  identityColor,
  type IdentityColorName,
} from "@/styles/identity-colors";
import {
  buildProviderLabelMap,
  formatDirectoryLabel,
  resolveDirectoryLabel,
  resolveProvidersToFetch,
} from "@/components/import-session-sheet-view-model";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { useHostProjects } from "@/projects/host-projects";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHostFeature } from "@/runtime/host-features";
import { ShellHostPickerSheet } from "@/shell/components/host-picker-sheet";
import { SearchModeBar } from "@/shell/components/search/search-mode-bar";
import { normalizeSearchQuery } from "@/shell/search/query";
import { useShellSearchBackPriority } from "@/shell/search/use-shell-search-back-priority";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { IMPORT_ROUTE_NAME, OFFICIAL, SHELL } from "@/shell/routes";
import { detailBack } from "@/shell/detail-back";
import {
  applyImportTreeCollapse,
  buildBadgeOpenTarget,
  buildImportRowBadgeMap,
  buildImportToastParts,
  buildImportTree,
  classifyImportError,
  deriveImportStatus,
  filterImportEntriesByQuery,
  importRowTimeLabel,
  importTreeAutoExpandKeys,
  mapEntriesToImportRows,
  summarizeImportAttempts,
  type ImportAttempt,
  type ImportParentLabel,
  type ImportRow,
  type ImportRowBadge,
  type ImportRowFolder,
  type ImportTreeItem,
} from "@/shell/import/rows";
import { useImportList } from "@/shell/import/use-import-list";
import { useImportSelection } from "@/shell/import/use-import-selection";
import { useImportAgentHandleIndex } from "@/shell/import/use-import-agent-index";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { createChatOpener } from "@/shell/chats/open-agent";
import { chatLastEventAtFromAgent } from "@/shell/chats/derive";
import { projectAvatarFor } from "@/shell/chats/project-avatar";
import { deriveProjectKey, deriveProjectName } from "@/utils/agent-grouping";
import { OWNERSHIP_OPEN_DIALOG_KEYS, OWNERSHIP_SEND_BODY_KEY } from "@/shell/chats/ownership";
import { requestChatsFilter } from "@/shell/chats/filter-request";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useSessionStore } from "@/stores/session-store";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";

// B5-IMPORT2 (D20): 60→200=服务端 limit 上限；includeExisting 起列表不再剔除
// 已存在行，行数≈omp resume 可见数，200 内一屏全覆盖（超出分页=后续卡）。
const IMPORT_LIST_LIMIT = 200;
// C23: 搜索防抖（对齐官方 import-session-sheet 姿势，卡口径 ~300ms）。
const IMPORT_SEARCH_DEBOUNCE_MS = 300;

// Stable prop identities (react-perf lint): the checkbox state objects and the
// pressable style callback are created once at module scope.
const ACCESSIBILITY_CHECKED = { checked: true };
const ACCESSIBILITY_UNCHECKED = { checked: false };
// B4-IMPORT: 折叠态初值（裁定 11「不持久化」=组件态，模块级空集=每次进屏全折叠
// 的共享初值）；chevron 命中区外扩（C12 44dp 姿势的列表行内版）。
const EMPTY_ROOTS: ReadonlySet<string> = new Set<string>();
const CHEVRON_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 } as const;

function rowPressStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, pressed && styles.rowPressed];
}

// KI-4: depth1 子行=左缩进（模块级稳定引用，react-perf 纪律同 rowPressStyle）。
function childRowPressStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, styles.rowChild, pressed && styles.rowPressed];
}

// B8-IMPORT F23: 与会话行同一张色块表——identity 调色板的十个静音填充是
// scheme-independent 的，模块级建一次，每次渲染交给 Unistyles 同一个对象
// （chat-list-row 同款纪律：无内联样式、无逐帧 identity 抖动）。
const AVATAR_FILL = Object.fromEntries(
  IDENTITY_COLOR_NAMES.map((name) => [name, { backgroundColor: identityColor(name) }]),
) as Record<IdentityColorName, { backgroundColor: string }>;

/**
 * 项目 icon 色块（F23）：复用会话行同款取字/配色算法（`projectAvatarFor`=项目名
 * 首字 + 哈希槽位），同一个项目在导入屏与对话 tab 落在同一格颜色上。没有归属信息
 * 的行仍出色块（「?」）——空槽会把行压矮，两屏就不同高了。
 */
function ImportProjectAvatar({
  projectName,
  index,
}: {
  projectName: string | null;
  index: number;
}) {
  const avatar = useMemo(() => projectAvatarFor(projectName ?? ""), [projectName]);
  return (
    <View
      style={[styles.rowAvatar, AVATAR_FILL[avatar.colorName]]}
      testID={`shell-import-avatar-${index}`}
    >
      <Text style={styles.rowAvatarGlyph} numberOfLines={1}>
        {avatar.initial}
      </Text>
    </View>
  );
}

/**
 * B4-IMPORT（裁定 11/12）行渲染事实 + B8-IMPORT（F23）版式对齐壳会话行终态
 * （B8-ROWPILL 落地后的 chat-list-row，对齐观感非照抄实现）：项目 icon 色块 |
 * 标题行=标题（截断）+「可能活跃」/状态徽标紧随+时间贴右缘 | 副标题=项目 · 末条
 * 摘要。checkbox 列与 chevron/子计数列原样保留（多选语义不动）。
 * - childCount>0 → 左侧 chevron+计数徽标「N」独立命中区（点 chevron=展开/收起，
 *   行主体=勾选，现语义不动）；无子行占同宽空槽保持标题对齐。
 * - badge=已导入/已归档 → 标题行灰徽标（归档带箱形 icon=壳内归档语义形，Q2③
 *   同系）、勾选框禁用置灰；行主体改跳转：agentId 命中体→C4 open-intent /
 *   归档体→对话 tab 已归档筛选；聚合徽标（agentId=null，父全子已导入）无单一
 *   跳转目标，点主体退化为展开/收起。
 */
export function ImportRowCell({
  row,
  depth,
  index,
  selected,
  disabled,
  badge,
  childCount,
  rootKey,
  expanded,
  onToggle,
  onToggleExpand,
  onOpenBadge,
}: {
  row: ImportRow;
  depth: 0 | 1;
  index: number;
  selected: boolean;
  disabled: boolean;
  badge: ImportRowBadge | null;
  childCount: number;
  rootKey: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  onToggleExpand: (rootKey: string) => void;
  onOpenBadge: (badge: ImportRowBadge) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  // R2-14: a non-compliant host's date string maps to lastActivityAt=null on
  // the row; the meta shows the bilingual placeholder instead of the
  // "Invalid Date NaN" the formatter would produce for NaN.
  const timeLabel = importRowTimeLabel(row.lastActivityAt) ?? t("import.metaTimeUnknown");
  // F23: 副标题=项目 · 末条摘要（会话行同款两段落）。nameLabel=官方 title
  // （子代理名那类）仍降级在这里，名字不丢（KI-4 不变量）；单条输入的会话
  // preview 与标题同文，不重复展示。时间不在此行——它贴标题行的右缘。
  const summary = row.preview === row.title ? null : row.preview;
  const subtitle = [row.folder, row.nameLabel, summary].filter(Boolean).join(" · ");
  const handleExpand = useCallback(() => onToggleExpand(rootKey), [onToggleExpand, rootKey]);
  const handlePress = useCallback(() => {
    if (badge?.agentId) {
      onOpenBadge(badge);
    } else if (badge) {
      // 聚合徽标父行：没有一个「该会话」可跳，主体点击退化为展开/收起。
      onToggleExpand(rootKey);
    } else {
      onToggle(row.key);
    }
  }, [badge, onOpenBadge, onToggle, onToggleExpand, rootKey, row.key]);
  const badgeLabel = badge
    ? t(badge.state === "archived" ? "import.badgeArchived" : "import.badgeImported")
    : null;
  // 会话行同款纪律（R4-13）：accessibilityLabel 替换掉全部子文本，所以标题、
  // 副标题、时间、徽标都要在这条串里说完（此前只有徽标行有 label，且只说标题）。
  const rowLabel = [row.title, subtitle, timeLabel, badgeLabel].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole={badge ? "button" : "checkbox"}
      accessibilityLabel={rowLabel}
      accessibilityState={selected ? ACCESSIBILITY_CHECKED : ACCESSIBILITY_UNCHECKED}
      disabled={disabled}
      testID={`shell-import-row-${index}`}
      style={depth === 1 ? childRowPressStyle : rowPressStyle}
    >
      {childCount > 0 ? (
        <Pressable
          onPress={handleExpand}
          accessibilityRole="button"
          accessibilityLabel={t(expanded ? "import.collapseChildren" : "import.expandChildren", {
            count: childCount,
          })}
          hitSlop={CHEVRON_HIT_SLOP}
          testID={`shell-import-row-${index}-chevron`}
          style={styles.rowChevron}
        >
          {expanded ? (
            <ChevronDown size={15} color={styles.chevron.color} />
          ) : (
            <ChevronRight size={15} color={styles.chevron.color} />
          )}
          <Text style={styles.rowChildCount}>{childCount}</Text>
        </Pressable>
      ) : (
        <View style={styles.rowChevronSpacer} />
      )}
      <ImportProjectAvatar projectName={row.projectName} index={index} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleRow}>
          {/* KI-4: 树形连接符=字形，不占 i18n。 */}
          <Text
            style={styles.rowTitle}
            numberOfLines={1}
            testID={`shell-import-row-${index}-title`}
          >
            {depth === 1 ? "└ " : ""}
            {row.title}
          </Text>
          {/* C25: 「可能活跃」= mtime 新鲜度启发式，非存活证明；token 色小徽标
              （刻意不用状态灯，避免与会话 tab 四态灯混淆）。F23 不动它的逻辑。 */}
          {row.looksActive ? (
            <Text style={styles.rowActiveBadge} testID={`shell-import-row-${index}-active`}>
              {t("import.activeBadge")}
            </Text>
          ) : null}
          {/* B4-IMPORT 裁定 12: 已导入（灰）/已归档（灰+箱形归档语义 icon）。
              F23: 已归档 > 已导入（rows.mergeImportBadgeFacts）——两个事实同时
              成立时这里只有一枚「已归档」，点按跳归档段。 */}
          {badge ? (
            <View
              style={styles.rowStateBadge}
              testID={`shell-import-row-${index}-badge-${badge.state}`}
            >
              {badge.state === "archived" ? (
                <Archive size={11} color={styles.rowStateBadgeText.color} />
              ) : null}
              <Text style={styles.rowStateBadgeText}>{badgeLabel}</Text>
            </View>
          ) : null}
          {/* F23（会话行 titleTrailing 同款）: 右缘组吃掉标题行的剩余宽度并把时间
              钉在右端——标题再长也只截标题，时间不会被挤出行。 */}
          <View style={styles.rowTitleTrailing}>
            <Text
              style={styles.rowTime}
              numberOfLines={1}
              testID={`shell-import-row-${index}-time`}
            >
              {timeLabel}
            </Text>
          </View>
        </View>
        <Text
          style={styles.rowMeta}
          numberOfLines={1}
          testID={`shell-import-row-${index}-subtitle`}
        >
          {subtitle}
        </Text>
      </View>
      <View
        style={[styles.checkbox, selected && styles.checkboxOn, badge && styles.checkboxDisabled]}
      >
        {selected ? <Check size={14} color={styles.check.color} /> : null}
      </View>
    </Pressable>
  );
}

// KI-4: 孤儿子组组头（父不在列表）——不可勾选的 muted 行；label 三态措辞：
// 有名/裸 id（「源:」）/无名。B4-IMPORT: 组头=该组折叠单元的行主体，点组头
// 展开/收起（chevron+计数与 session 父行同款）。
function ImportOrphanGroupHeader({
  label,
  index,
  childCount,
  rootKey,
  expanded,
  onToggleExpand,
}: {
  label: ImportParentLabel | null;
  index: number;
  childCount: number;
  rootKey: string;
  expanded: boolean;
  onToggleExpand: (rootKey: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const text = label
    ? t(label.raw ? "import.orphanGroupRaw" : "import.orphanGroup", { parent: label.text })
    : t("import.orphanGroupUnknown");
  const handleExpand = useCallback(() => onToggleExpand(rootKey), [onToggleExpand, rootKey]);
  return (
    <Pressable
      onPress={handleExpand}
      accessibilityRole="button"
      accessibilityLabel={t(expanded ? "import.collapseChildren" : "import.expandChildren", {
        count: childCount,
      })}
      hitSlop={CHEVRON_HIT_SLOP}
      testID={`shell-import-orphan-group-${index}`}
      style={styles.orphanGroup}
    >
      {expanded ? (
        <ChevronDown size={15} color={styles.chevron.color} />
      ) : (
        <ChevronRight size={15} color={styles.chevron.color} />
      )}
      <Text style={styles.orphanGroupText} numberOfLines={1}>
        {text}
      </Text>
      <Text style={styles.rowChildCount}>{childCount}</Text>
    </Pressable>
  );
}

// C12: 44dp host-chip target (module const — react-perf forbids per-render objects).
const HOST_CHIP_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 } as const;

// 状态行：文案来自 deriveImportStatus；加载态带 spinner，失败态带重试。
function ImportStatusBlock({
  message,
  showSpinner,
  showRetry,
  onRetry,
}: {
  message: string;
  showSpinner: boolean;
  showRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  // C12: 静默状态（无主机/未选/空列表）也走 图标+一句引导 的空态范式。
  return (
    <View style={styles.statusWrap} testID="shell-import-status">
      {showSpinner ? (
        <LoadingSpinner size="small" color={styles.headerIcon.color} />
      ) : (
        <Inbox size={18} color={styles.headerIcon.color} />
      )}
      <Text style={styles.statusText}>{message}</Text>
      {showRetry ? (
        <Button variant="ghost" size="sm" onPress={onRetry}>
          {t("import.retry")}
        </Button>
      ) : null}
    </View>
  );
}

export default function ShellImportScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const hosts = useHosts();

  const [serverId, setServerId] = useState<string | null>(null);
  const client = useHostRuntimeClient(serverId ?? "");

  // KI-5: 挂载自动选（唯一 host 免弹直入）保留；chip 点击必弹 sheet——入口免弹与
  // 点击必弹是两件事（裁定），不再走 useHostChooser 的单主机静默捷径。
  const [hostSheetOpen, setHostSheetOpen] = useState(false);
  const soleHostId = hosts.length === 1 ? hosts[0].serverId : null;
  useEffect(() => {
    if (serverId || !soleHostId) return;
    setServerId(soleHostId);
  }, [serverId, soleHostId]);

  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? "";
  const handleHostChip = useCallback(() => {
    if (!serverId && hosts.length === 0) {
      router.push(OFFICIAL.welcome as Href);
    } else {
      setHostSheetOpen(true);
    }
  }, [hosts.length, serverId]);
  const handleHostPick = useCallback((picked: string) => {
    setServerId(picked);
    setHostSheetOpen(false);
  }, []);
  const handleAddHost = useCallback(() => {
    setHostSheetOpen(false);
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);
  const handleHostSheetClose = useCallback(() => setHostSheetOpen(false), []);

  // C23 搜索：bar morph 复用 chats/workspace 的 SearchModeBar。capability gate
  // `importSessionSearch`=false（旧 daemon）时 query 不进 RPC，改在已载条目上
  // 本地过滤（rows.filterImportEntriesByQuery）；空态文案据 queryRunsLocally 区分。
  const [searchActive, setSearchActive] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const supportsSearch = useHostFeature(serverId, "importSessionSearch");
  const debouncedInput = useDebouncedValue(searchInput, IMPORT_SEARCH_DEBOUNCE_MS);
  const normalizedQuery = normalizeSearchQuery(debouncedInput);
  const remoteQuery = supportsSearch ? normalizedQuery : "";
  const handleSearchOpen = useCallback(() => setSearchActive(true), []);
  const handleSearchClose = useCallback(() => {
    setSearchActive(false);
    setSearchInput("");
  }, []);

  // B4-BACK (F9/裁定 15): Android back exits the C23 搜索态 first — same
  // handleSearchClose the 取消 button rides (清 input + 收起 morph); the claim
  // only lands while the import screen is the frontmost route.
  useShellSearchBackPriority(searchActive, handleSearchClose, {
    name: IMPORT_ROUTE_NAME,
  });

  // F1 (review): the fetch lifecycle lives in useImportList — its stale-host guard
  // is what stops a mid-import host switch from letting A's closure overwrite B.
  // C23: query 进 hook（requestSeq 覆盖 query 竞态；旧 query 响应不落地）。
  const { listState, load } = useImportList(IMPORT_LIST_LIMIT, serverId, client, remoteQuery);
  const handleRefresh = useCallback(() => {
    void load();
  }, [load]);

  const { supportsSnapshot, entries: snapshotEntries } = useProvidersSnapshot(serverId, {
    cwd: null,
    enabled: Boolean(serverId),
  });
  const providersToFetch = resolveProvidersToFetch(supportsSnapshot, snapshotEntries);
  const providerLabelById = useMemo(
    () => buildProviderLabelMap(snapshotEntries),
    [snapshotEntries],
  );

  const hostProjects = useHostProjects(serverId ? [serverId] : []);
  // 目录解析的输入面（一次映射，folderFor 逐行只读）。
  const projectDirs = useMemo(
    () =>
      hostProjects.map((project) => ({
        rootPath: project.iconWorkingDir,
        name: project.projectName,
      })),
    [hostProjects],
  );
  // F23: 一次目录解析出两段事实——副标题的项目段（官方 formatDirectoryLabel 结果，
  // 含 worktree detail）+ icon 色块的项目名。项目名与会话行同源：命中在册项目=
  // 项目名（=projectPlacement.projectName 同串→同色）；未命中时 resolveDirectoryLabel
  // 回吐整条路径，这时取 cwd 尾段=会话行的兜底名 deriveProjectName(deriveProjectKey(cwd))，
  // 于是同一个目录在导入屏与对话 tab 落在同一格颜色上。
  const folderFor = useCallback(
    (cwd: string): ImportRowFolder => {
      const label = resolveDirectoryLabel(cwd, projectDirs);
      const owned = projectDirs.some((project) => project.name === label.name);
      return {
        label: formatDirectoryLabel(label),
        projectName: owned ? label.name : deriveProjectName(deriveProjectKey(cwd)),
      };
    },
    [projectDirs],
  );

  const rows = useMemo(() => {
    const entries =
      !supportsSearch && normalizedQuery.length > 0
        ? filterImportEntriesByQuery(listState.entries, normalizedQuery)
        : listState.entries;
    return mapEntriesToImportRows(entries, folderFor);
  }, [folderFor, listState.entries, normalizedQuery, supportsSearch]);

  // KI-4: 过滤发生在条目层（rows 已按 query 筛过），树在过滤视图上现建——
  // 被过滤掉的父自然让子成为孤儿组。
  const treeItems = useMemo(() => buildImportTree(rows), [rows]);

  // B4-IMPORT 裁定 12 → B5-IMPORT2 → B8-IMPORT F23: 徽标事实两源并列——服务端
  // entry.existing（新 daemon，含 omp resume 链祖先）回答「导入过没有」，壳侧 handle
  // 索引（agent 目录 persistence 双字段 + 壳归档 store）回答「归档了没有」；
  // rows.mergeImportBadgeFacts 合并，已归档 > 已导入。父行全子「已导入」才聚合标。
  // 两源皆空=全行维持现状。
  const agentIndex = useImportAgentHandleIndex(serverId);
  const badgeMap = useMemo(
    () => buildImportRowBadgeMap(treeItems, agentIndex),
    [agentIndex, treeItems],
  );

  // B4-IMPORT 裁定 11: 折叠态=纯组件态（不持久化，每次进屏默认全折叠）；
  // serverId 存在值里=切主机同拍作废，旧主机的展开键不读。搜索/过滤态强制展开
  // 所有带子单元（能进树的 depth1 都是命中者，收起=把搜索结果藏起来）。
  const [expandedState, setExpandedState] = useState<{
    serverId: string | null;
    keys: ReadonlySet<string>;
  }>({ serverId: null, keys: EMPTY_ROOTS });
  const expandedRoots = useMemo(() => {
    const manual = expandedState.serverId === serverId ? expandedState.keys : EMPTY_ROOTS;
    if (normalizedQuery.length === 0) return manual;
    const auto = importTreeAutoExpandKeys(treeItems);
    if (auto.size === 0) return manual;
    if (manual.size === 0) return auto;
    return new Set([...auto, ...manual]);
  }, [expandedState, normalizedQuery, serverId, treeItems]);
  const visibleItems = useMemo(
    () => applyImportTreeCollapse(treeItems, expandedRoots),
    [expandedRoots, treeItems],
  );
  const handleToggleExpand = useCallback(
    (rootKey: string) => {
      setExpandedState((prev) => {
        const base = prev.serverId === serverId ? prev.keys : EMPTY_ROOTS;
        const next = new Set(base);
        if (next.has(rootKey)) next.delete(rootKey);
        else next.add(rootKey);
        return { serverId, keys: next };
      });
    },
    [serverId],
  );

  // KI-13: 勾选集生命周期（含切主机复位）在 useImportSelection；rows 由
  // useImportList 切换同拍清空——列表与勾选两侧都进新态，旧主机零残留。
  const { selectedSet, toggle: handleToggle, clear: clearSelection } = useImportSelection(serverId);
  // 裁定 12: 徽标行注定幂等/失败——勾选禁用之外，提交集同口径剔除（勾选后
  // 目录才到货的竞态行也进不了 runImport；classifyImportError 链保留兜底）。
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(row.key) && !badgeMap.has(row.key)),
    [badgeMap, rows, selectedSet],
  );

  // R4-06（开屏=危险时刻覆盖面收口）: 徽标行跳转与对话行 tap 走同一条 opener
  // 链——createChatOpener.open = R4 开屏门 → C24 fork 门 → markRead → recordVisit
  // → 官方 navigateToAgent。此前「已导入」分支裸 shellNavigateToAgent 绕开了全部
  // 四职责（无已读戳、首开跳过 fork 警告、更绕过 R4 守卫）。接线与
  // chats-screen-body 同款（同一对 store、同一个 confirmDialog、同一组文案键）。
  const markRead = usePaseoGoReadStateStore((state) => state.markRead);
  const opener = useMemo(
    () =>
      createChatOpener({
        markRead,
        navigateToAgent: shellNavigateToAgent,
        lastEventAtOf: (hostId, agentId) => {
          const agent = useSessionStore.getState().sessions[hostId]?.agents.get(agentId);
          // R2-14: null（垃圾日期）= undefined=无水线可取，opener 保压快照。
          return agent ? (chatLastEventAtFromAgent(agent) ?? undefined) : undefined;
        },
        confirmFork: () =>
          confirmDialog({
            title: t("chats.fork.title"),
            message: t("chats.fork.message"),
            confirmLabel: t("chats.fork.confirm"),
            cancelLabel: t("chats.fork.cancel"),
          }),
        forkAcknowledged: (key) => usePaseoGoForkAckStore.getState().ackedKeys.includes(key),
        acknowledgeFork: (key) => usePaseoGoForkAckStore.getState().ack(key),
        // B4-R4OPEN (裁定 18) 同款分级门: external·运行中 → 弹「仍要打开」。
        confirmOwnership: (decision) =>
          confirmDialog({
            title: t(OWNERSHIP_OPEN_DIALOG_KEYS.title),
            message: t(OWNERSHIP_SEND_BODY_KEY[decision]),
            confirmLabel: t(OWNERSHIP_OPEN_DIALOG_KEYS.confirm),
            cancelLabel: t(OWNERSHIP_OPEN_DIALOG_KEYS.cancel),
          }),
        section: "chats",
      }),
    [markRead, t],
  );

  // B4-IMPORT 裁定 12: 徽标行点主体跳转。已导入→该会话（上面的 opener 全链）；
  // 已归档→对话 tab 已归档筛选——filter 经模块总线投递（宽屏 body 在 navigator
  // 外，路由参数到不了它，section-focus 同构），导航动词 navigate=回到并激活
  // chats tab（不新增栈帧）。R4-17（裁定 12「高亮该行」子句）: 意图随行键一起
  // 投递，body 消费=切页+归顶+一次性高亮（use-chats-filter-jump）。
  const handleOpenBadge = useCallback(
    (badge: ImportRowBadge) => {
      if (!serverId || !badge.agentId) return;
      if (badge.state === "archived") {
        requestChatsFilter({
          filter: "archived",
          highlightKey: `${serverId}:${badge.agentId}`,
        });
        router.navigate(SHELL.chats as Href);
        return;
      }
      // 目录行直读（徽标本就由它派生）；行没了（删会话/目录清的竞态）= 不开。
      const agent = useSessionStore.getState().sessions[serverId]?.agents.get(badge.agentId);
      const target = buildBadgeOpenTarget(serverId, badge.agentId, agent);
      if (target) void opener.open(target);
    },
    [opener, serverId],
  );

  // KI-9 返回：真弹栈回来源（＋菜单在对话 tab，back 即回对话列表）；深链直达时
  // 栈下无屏，兑底 replace 回对话 tab。硬件/手势返回由根栈原生处理。
  const goBackToChats = useCallback(() => detailBack(SHELL.chats), []);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const runImport = useCallback(async () => {
    if (!client || progress || selectedRows.length === 0) return;
    const targets = [...selectedRows];
    setProgress({ current: 0, total: targets.length });
    const attempts: ImportAttempt[] = [];
    for (const row of targets) {
      try {
        await client.importAgent({
          providerId: row.providerId,
          providerHandleId: row.providerHandleId,
          cwd: row.cwd,
        });
        attempts.push({ key: row.key, ok: true });
      } catch (error) {
        const { alreadyImported } = classifyImportError(error);
        attempts.push({ key: row.key, ok: false, alreadyImported });
      }
      setProgress((prev) => (prev ? { ...prev, current: prev.current + 1 } : prev));
    }
    setProgress(null);
    const summary = summarizeImportAttempts(attempts);
    // C12: 成功动作触觉——有真实导入落地才 Success。
    if (summary.imported > 0)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const message = buildImportToastParts(summary)
      .map((part) => t(`import.toast.${part.key}`, { count: part.count }))
      .join(" · ");
    if (message) toast.show(message);
    if (summary.imported > 0) {
      // 回对话列表：新 agent 经订阅出现，点开走 C4 opener（timeline 完整）。
      clearSelection();
      goBackToChats();
    }
    void load();
  }, [clearSelection, client, goBackToChats, load, progress, selectedRows, t, toast]);
  const handleImportPress = useCallback(() => {
    void runImport();
  }, [runImport]);

  const status = deriveImportStatus({
    hostCount: hosts.length,
    hasServerId: serverId !== null,
    supportsSnapshot,
    hasClient: Boolean(client),
    listStatus: listState.status,
    errorMessage: listState.error,
    rowCount: rows.length,
    alreadyImportedCount: listState.alreadyImportedCount,
    hasNoImportableProviders: providersToFetch !== null && providersToFetch.length === 0,
    hasQuery: normalizedQuery.length > 0,
    queryRunsLocally: !supportsSearch && normalizedQuery.length > 0,
  });
  // JSX-as-prop 规避：header/footer 元素在 memo 里成形，FlatList 拿到稳定引用。
  const listHeader = useMemo(
    () =>
      status ? (
        <ImportStatusBlock
          message={t(status.key, status.params)}
          showSpinner={listState.status === "loading" && rows.length === 0 && Boolean(client)}
          showRetry={listState.status === "error" && Boolean(client)}
          onRetry={handleRefresh}
        />
      ) : null,
    [client, handleRefresh, listState.status, rows.length, status, t],
  );
  const listFooter = useMemo(
    () =>
      listState.status === "ready" && listState.providerErrors.length > 0 ? (
        <View style={styles.providerErrors} testID="shell-import-provider-errors">
          {listState.providerErrors.map((row) => (
            <Text key={`${row.provider}:${row.message}`} style={styles.providerErrorText}>
              {t("import.providerError", {
                provider: providerLabelById.get(row.provider) ?? row.provider,
                message: row.message,
              })}
            </Text>
          ))}
        </View>
      ) : null,
    [listState.providerErrors, listState.status, providerLabelById, t],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ImportTreeItem; index: number }) =>
      item.kind === "session" ? (
        <ImportRowCell
          row={item.row}
          depth={item.depth}
          index={index}
          selected={selectedSet.has(item.row.key)}
          disabled={progress !== null}
          badge={badgeMap.get(item.row.key) ?? null}
          childCount={item.childCount}
          rootKey={item.rootKey}
          expanded={expandedRoots.has(item.rootKey)}
          onToggle={handleToggle}
          onToggleExpand={handleToggleExpand}
          onOpenBadge={handleOpenBadge}
        />
      ) : (
        <ImportOrphanGroupHeader
          label={item.label}
          index={index}
          childCount={item.childCount}
          rootKey={item.key}
          expanded={expandedRoots.has(item.key)}
          onToggleExpand={handleToggleExpand}
        />
      ),
    [
      badgeMap,
      expandedRoots,
      handleOpenBadge,
      handleToggle,
      handleToggleExpand,
      progress,
      selectedSet,
    ],
  );
  const keyExtractor = useCallback(
    (item: ImportTreeItem) => (item.kind === "session" ? item.row.key : item.key),
    [],
  );

  const isBusy = progress !== null;
  const listRefreshing = Boolean(client) && listState.status === "loading";
  const refreshControl = useMemo(
    () => <RefreshControl refreshing={listRefreshing} onRefresh={handleRefresh} />,
    [handleRefresh, listRefreshing],
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {searchActive ? (
          <>
            <Pressable
              onPress={goBackToChats}
              accessibilityRole="button"
              hitSlop={10}
              testID="shell-import-back"
              style={styles.headerButton}
            >
              <ChevronLeft size={20} color={styles.headerIcon.color} />
            </Pressable>
            <View style={styles.searchWrap}>
              <SearchModeBar
                onQueryChange={setSearchInput}
                onCancel={handleSearchClose}
                placeholder={t("import.searchPlaceholder")}
                inputTestID="shell-import-search-input"
                cancelTestID="shell-import-search-cancel"
              />
            </View>
          </>
        ) : (
          <>
            <Pressable
              onPress={goBackToChats}
              accessibilityRole="button"
              hitSlop={10}
              testID="shell-import-back"
              style={styles.headerButton}
            >
              <ChevronLeft size={20} color={styles.headerIcon.color} />
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>{t("import.title")}</Text>
              <Pressable
                onPress={handleHostChip}
                accessibilityRole="button"
                hitSlop={HOST_CHIP_HIT_SLOP}
                testID="shell-import-host"
                style={styles.hostRow}
              >
                <Text style={styles.hostLabel} numberOfLines={1}>
                  {hostLabel || t("import.noHost")}
                </Text>
                <ChevronDown size={13} color={styles.headerIcon.color} />
              </Pressable>
            </View>
            <Pressable
              onPress={handleSearchOpen}
              accessibilityRole="search"
              hitSlop={10}
              testID="shell-import-search"
              style={styles.headerButton}
            >
              <Search size={17} color={styles.headerIcon.color} />
            </Pressable>
            <Pressable
              onPress={handleRefresh}
              accessibilityRole="button"
              hitSlop={10}
              disabled={isBusy || !client}
              testID="shell-import-refresh"
              style={styles.headerButton}
            >
              <RotateCw size={17} color={styles.headerIcon.color} />
            </Pressable>
          </>
        )}
      </View>

      <FlatList
        data={visibleItems}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={refreshControl}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        testID="shell-import-list"
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          variant="default"
          testID="shell-import-submit"
          disabled={selectedRows.length === 0 || isBusy || !client}
          onPress={handleImportPress}
          style={styles.submitButton}
        >
          {isBusy
            ? t("import.importing", { current: progress.current, total: progress.total })
            : t("import.submit", { count: selectedRows.length })}
        </Button>
      </View>

      {/* KI-5: chip 点击恒弹；「添加主机」走官方加机路由（与 host-chooser 零主机分支同路径）。 */}
      <ShellHostPickerSheet
        open={hostSheetOpen}
        hosts={hosts}
        currentServerId={serverId}
        onPick={handleHostPick}
        onAddHost={handleAddHost}
        onClose={handleHostSheetClose}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerButton: {
    padding: theme.spacing[1],
  },
  headerIcon: {
    color: theme.colors.foregroundMuted,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
    paddingVertical: theme.spacing[2],
  },
  hostLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    maxWidth: 180,
  },
  searchWrap: {
    flex: 1,
  },
  listContent: {
    paddingBottom: theme.spacing[4],
  },
  statusWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    flexWrap: "wrap",
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowPressed: {
    opacity: 0.7,
  },
  // B8-IMPORT F23: 项目 icon 色块=会话行同款 40dp 圆角方块（填充色来自模块级
  // AVATAR_FILL，字色=IDENTITY_GLYPH_COLOR——调色板按「一个浅色字」校准，
  // 不跟主题 token，暗色下 accentForeground 会把对比拉到 4.5:1 以下）。
  rowAvatar: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  rowAvatarGlyph: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: IDENTITY_GLYPH_COLOR,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowTitle: {
    // F23: 与会话行同字号（base）；只有标题可收缩截断，徽标与时间都是 shrink-0。
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  // F23（会话行 titleTrailing 同款）: 标题行右缘组——flexGrow 吃掉剩余宽度、
  // flex-end 把内容钉到右端、flexShrink 0 让长标题挤的是标题不是时间。
  rowTitleTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: "flex-end",
  },
  rowTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  // KI-4: depth1 子行左缩进（连接符 `└` 在标题里，样式只加左边距）。
  rowChild: {
    paddingLeft: theme.spacing[8],
  },
  // KI-4: 孤儿子组组头——无底边线，与成员贴成一个视觉块，块间分隔沿用上一行
  // session 行的底边线。B4-IMPORT: 组头整体=折叠单元主体（点=展开/收起），
  // chevron+计数与 session 父行同款。
  orphanGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  orphanGroupText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowActiveBadge: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 0,
  },
  // B4-IMPORT 裁定 12: 状态徽标=灰 chip（已导入纯文字；已归档加箱形 icon，
  // Q2③ 归档图标语系）。刻意小一号弱于「可能活跃」——它是事实不是启发式，
  // 但行主角仍是标题。
  rowStateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    flexShrink: 0,
  },
  rowStateBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // B4-IMPORT 裁定 11: chevron+子计数徽标「N」=独立命中区；无子行占同宽空槽，
  // depth0 各行标题对齐不随折叠态抖动。
  rowChevron: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 30,
    paddingVertical: 2,
  },
  rowChevronSpacer: {
    width: 30,
  },
  chevron: {
    color: theme.colors.foregroundMuted,
  },
  rowChildCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // F23: 副标题=项目 · 末条摘要（会话行 subtitle 同款字号/色）。
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  // 裁定 12: 徽标行勾选禁用——置灰即可，跳转反馈由徽标 chip 承担。
  checkboxDisabled: {
    opacity: 0.35,
  },
  check: {
    color: theme.colors.accentForeground,
  },
  providerErrors: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: 2,
  },
  providerErrorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  submitButton: {
    alignSelf: "stretch",
  },
}));
