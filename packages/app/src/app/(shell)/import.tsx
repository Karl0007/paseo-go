// 会话导入屏 (card C10, DESIGN §8): ＋菜单 →「导入会话」进入本屏。流程按卡的裁定：
// 选 host（官方 useHostChooser，单 host 自动选中）→ 列可导入会话（标题/时间/项目，
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
import { useHostChooser } from "@/hosts/host-chooser";
import { useHostProjects } from "@/projects/host-projects";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHostFeature } from "@/runtime/host-features";
import { SearchModeBar } from "@/shell/components/search/search-mode-bar";
import { normalizeSearchQuery } from "@/shell/search/query";
import { formatCompactTimeAgo } from "@/utils/time";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL, SHELL_TAB } from "@/shell/routes";
import {
  buildImportToastParts,
  classifyImportError,
  deriveImportStatus,
  filterImportEntriesByQuery,
  mapEntriesToImportRows,
  summarizeImportAttempts,
  toggleRowSelection,
  type ImportAttempt,
  type ImportRow,
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

function ImportRowCell({
  row,
  index,
  serverId,
  selected,
  disabled,
  onToggle,
}: {
  row: ImportRow;
  index: number;
  serverId: string | null;
  selected: boolean;
  disabled: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const ProviderIcon = getProviderIcon(row.providerId, serverId);
  const meta = [row.folder, formatCompactTimeAgo(new Date(row.lastActivityAt))]
    .filter(Boolean)
    .join(" · ");
  const handlePress = useCallback(() => onToggle(row.key), [onToggle, row.key]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={selected ? ACCESSIBILITY_CHECKED : ACCESSIBILITY_UNCHECKED}
      disabled={disabled}
      testID={`shell-import-row-${index}`}
      style={rowPressStyle}
    >
      <ProviderIcon size={16} color={styles.rowIcon.color} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleRow}>
          <Text style={styles.rowTitle} numberOfLines={1}>
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
        {/* C25: 父链=副标题位（主标题不动）；字段缺席（旧 daemon/无父链
            provider）=整行不渲染。 */}
        {row.parentLabel ? (
          <Text
            style={styles.rowParent}
            numberOfLines={1}
            testID={`shell-import-row-${index}-parent`}
          >
            {t(row.parentIsRawId ? "import.subsessionRaw" : "import.subsession", {
              parent: row.parentLabel,
            })}
          </Text>
        ) : null}
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {row.preview}
        </Text>
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        {selected ? <Check size={14} color={styles.check.color} /> : null}
      </View>
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
  const navigation = useNavigation();
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const hosts = useHosts();
  const chooseHost = useHostChooser();

  const [serverId, setServerId] = useState<string | null>(null);
  const client = useHostRuntimeClient(serverId ?? "");

  // 进屏即选 host：官方 chooser，单 host 自动选中、多 host 弹层。关掉弹层没选也不
  // 重弹（deps 不变），顶栏主机 chip 随时可重开。
  useEffect(() => {
    if (serverId || hosts.length === 0) return;
    chooseHost({ title: t("import.chooseHost"), onChooseHost: (id) => setServerId(id) });
  }, [chooseHost, hosts.length, serverId, t]);

  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? "";
  const openHostChooser = useCallback(
    () => chooseHost({ title: t("import.chooseHost"), onChooseHost: (id) => setServerId(id) }),
    [chooseHost, t],
  );
  const handleHostChip = useCallback(() => {
    if (!serverId && hosts.length === 0) {
      router.push(OFFICIAL.welcome as Href);
    } else {
      openHostChooser();
    }
  }, [hosts.length, openHostChooser, serverId]);

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
    ({ item, index }: { item: ImportRow; index: number }) => (
      <ImportRowCell
        row={item}
        index={index}
        serverId={serverId}
        selected={selectedSet.has(item.key)}
        disabled={progress !== null}
        onToggle={handleToggle}
      />
    ),
    [handleToggle, progress, selectedSet, serverId],
  );
  const keyExtractor = useCallback((item: ImportRow) => item.key, []);

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
        data={rows}
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
  rowParent: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
  rowPreview: {
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
