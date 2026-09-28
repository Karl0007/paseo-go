// 会话导入屏 (card C10, DESIGN §8): ＋菜单 →「导入会话」进入本屏。流程：
// 选 host（KI-5：挂载单 host 自动选中免弹；顶栏主机 chip 点击恒弹
// ShellHostPickerSheet，含「添加主机」行）→ 列可导入会话（标题/时间/项目，
// 数据源 daemon `fetch_recent_provider_sessions`，已导入的由 daemon 过滤）→ 勾选
// → 导入按钮（逐条进度 n/m）→ 成功 toast → 返回对话列表，新条目出现后点开即完整
// timeline（C4 opener）。重复导入按 daemon 的「already imported」错误归类为幂等
// 提示而非失败。状态判定/行映射/勾选/结果分类都在 @/shell/import/rows（纯逻辑，
// 单测覆盖），屏只剩数据接线与渲染。本屏是隐藏 tab（C5 KI-2 模式）：返回按钮与
// 硬件返回都经 tab navigator 跳回对话。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Check, ChevronDown, ChevronLeft, Inbox, RotateCw, Search } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getProviderIcon } from "@/components/provider-icons";
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
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL, SHELL_TAB } from "@/shell/routes";
import {
  buildImportToastParts,
  buildImportTree,
  classifyImportError,
  deriveImportStatus,
  filterImportEntriesByQuery,
  importRowTimeLabel,
  mapEntriesToImportRows,
  summarizeImportAttempts,
  toggleRowSelection,
  type ImportAttempt,
  type ImportParentLabel,
  type ImportRow,
  type ImportTreeItem,
} from "@/shell/import/rows";
import { useImportList } from "@/shell/import/use-import-list";

const IMPORT_LIST_LIMIT = 60;
// C23: 搜索防抖（对齐官方 import-session-sheet 姿势，卡口径 ~300ms）。
const IMPORT_SEARCH_DEBOUNCE_MS = 300;

// Stable prop identities (react-perf lint): the checkbox state objects and the
// pressable style callback are created once at module scope.
const ACCESSIBILITY_CHECKED = { checked: true };
const ACCESSIBILITY_UNCHECKED = { checked: false };

function rowPressStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, pressed && styles.rowPressed];
}

// KI-4: depth1 子行=左缩进（模块级稳定引用，react-perf 纪律同 rowPressStyle）。
function childRowPressStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, styles.rowChild, pressed && styles.rowPressed];
}

function ImportRowCell({
  row,
  depth,
  index,
  serverId,
  selected,
  disabled,
  onToggle,
}: {
  row: ImportRow;
  depth: 0 | 1;
  index: number;
  serverId: string | null;
  selected: boolean;
  disabled: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const ProviderIcon = getProviderIcon(row.providerId, serverId);
  // R2-14: a non-compliant host's date string maps to lastActivityAt=null on
  // the row; the meta shows the bilingual placeholder instead of the
  // "Invalid Date NaN" the formatter would produce for NaN.
  const timeLabel = importRowTimeLabel(row.lastActivityAt) ?? t("import.metaTimeUnknown");
  // KI-4: meta = folder · nameLabel? · time（子代理名降级到此，不丢）；
  // preview 行不再渲染（title=末次输入，同文重复）。
  const meta = [row.folder, row.nameLabel, timeLabel].filter(Boolean).join(" · ");
  const handlePress = useCallback(() => onToggle(row.key), [onToggle, row.key]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={selected ? ACCESSIBILITY_CHECKED : ACCESSIBILITY_UNCHECKED}
      disabled={disabled}
      testID={`shell-import-row-${index}`}
      style={depth === 1 ? childRowPressStyle : rowPressStyle}
    >
      <ProviderIcon size={16} color={styles.rowIcon.color} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleRow}>
          {/* KI-4: 树形连接符=字形，不占 i18n。 */}
          <Text style={styles.rowTitle} numberOfLines={1}>
            {depth === 1 ? "└ " : ""}
            {row.title}
          </Text>
          {/* C25: 「可能活跃」= mtime 新鲜度启发式，非存活证明；token 色小徽标
              （刻意不用状态灯，避免与会话 tab 四态灯混淆）。 */}
          {row.looksActive ? (
            <Text style={styles.rowActiveBadge} testID={`shell-import-row-${index}-active`}>
              {t("import.activeBadge")}
            </Text>
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        {selected ? <Check size={14} color={styles.check.color} /> : null}
      </View>
    </Pressable>
  );
}

// KI-4: 孤儿子组组头（父不在列表）——不可点、不可勾选的 muted 行；
// label 三态措辞：有名/裸 id（「源:」）/无名。
function ImportOrphanGroupHeader({
  label,
  index,
}: {
  label: ImportParentLabel | null;
  index: number;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const text = label
    ? t(label.raw ? "import.orphanGroupRaw" : "import.orphanGroup", { parent: label.text })
    : t("import.orphanGroupUnknown");
  return (
    <View style={styles.orphanGroup} testID={`shell-import-orphan-group-${index}`}>
      <Text style={styles.orphanGroupText} numberOfLines={1}>
        {text}
      </Text>
    </View>
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
  const navigation = useNavigation();
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
  const folderFor = useCallback(
    (cwd: string) =>
      formatDirectoryLabel(
        resolveDirectoryLabel(
          cwd,
          hostProjects.map((project) => ({
            rootPath: project.iconWorkingDir,
            name: project.projectName,
          })),
        ),
      ),
    [hostProjects],
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

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(row.key)),
    [rows, selectedSet],
  );
  const handleToggle = useCallback(
    (key: string) => setSelectedKeys((prev) => toggleRowSelection(prev, key)),
    [],
  );

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
      setSelectedKeys([]);
      navigation.navigate({ name: SHELL_TAB.chats } as never);
    }
    void load();
  }, [client, load, navigation, progress, selectedRows, t, toast]);
  const handleImportPress = useCallback(() => {
    void runImport();
  }, [runImport]);

  // 隐藏 tab 的返回：按钮与硬件返回都跳回对话 tab，不弹根栈（files 屏同款）。
  const goBackToChats = useCallback(
    () => navigation.navigate({ name: SHELL_TAB.chats } as never),
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        goBackToChats();
        return true;
      });
      return () => sub.remove();
    }, [goBackToChats]),
  );

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
          serverId={serverId}
          selected={selectedSet.has(item.row.key)}
          disabled={progress !== null}
          onToggle={handleToggle}
        />
      ) : (
        <ImportOrphanGroupHeader label={item.label} index={index} />
      ),
    [handleToggle, progress, selectedSet, serverId],
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
        data={treeItems}
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
  rowIcon: {
    color: theme.colors.foregroundMuted,
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
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  // KI-4: depth1 子行左缩进（连接符 `└` 在标题里，样式只加左边距）。
  rowChild: {
    paddingLeft: theme.spacing[8],
  },
  // KI-4: 孤儿子组组头——无底边线，与成员贴成一个视觉块，块间分隔沿用上一行
  // session 行的底边线。
  orphanGroup: {
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
  },
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
