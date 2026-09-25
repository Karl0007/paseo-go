// 工作区 tab (DESIGN §5, cards C5+C6+C7+C9): 搜索 (C9: the bar morphs into an input;
// 文件名 hits come from the session-store explorer cache — the protocol has no
// filename-search RPC, live-probed on both daemons, so only 已浏览目录 are covered,
// which the empty state says out loud; a hit pushes the C6 preview directly) →
// 收藏夹区 (files star + ⚡ 快捷指令混排) → 主机分组 (连接点 + 名称 + ⚙ 官方 host
// settings；离线置灰+重试) → 项目行 (workspace 名 + 活跃 agent 角标, 最近使用排序) →
// ＋新建项目 / ＋连接新主机 (官方流程). Cold start rides the official skeleton;
// pull-to-refresh re-pulls agents + directories.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FolderTree, Plus, Search, SearchX, Star, Zap, type LucideIcon } from "lucide-react-native";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useProjects } from "@/hooks/use-projects";
import { getHostRuntimeStore, useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL, shellCommandEditHref, shellFilesHref, shellPreviewHref } from "@/shell/routes";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { WorkspaceHostHeader } from "@/shell/components/workspace-host-header";
import { WorkspaceProjectRow } from "@/shell/components/workspace-project-row";
import { WorkspaceFavoriteRow } from "@/shell/components/workspace-favorite-row";
import { WorkspaceCommandRow } from "@/shell/components/workspace-command-row";
import {
  CommandWorkspacePickerSheet,
  type CommandWorkspaceOption,
} from "@/shell/components/command-workspace-picker";
import { usePaseoGoFavoritesStore, type ShellFavoriteFile } from "@/shell/stores/favorites";
import { usePaseoGoCommandsStore, type ShellCommand } from "@/shell/stores/commands";
import { useShellCommandRunner } from "@/shell/commands/use-shell-command-runner";
import { SearchModeBar } from "@/shell/components/search/search-mode-bar";
import { FileSearchRow } from "@/shell/components/search/file-search-row";
import {
  searchFileNames,
  type FileSearchEntry,
  type FileSearchHit,
  type FileSearchSource,
} from "@/shell/search/file-search";
import { normalizeSearchQuery } from "@/shell/search/query";
import {
  buildWorkspaceTree,
  type ShellHostSection,
  type ShellWorkspaceRow,
} from "@/shell/workspace/derive";

const REFRESH_SETTLE_MS = 700;

type TreeItem =
  | { type: "favorites-header"; key: string }
  | { type: "favorites-empty"; key: string }
  | { type: "new-command"; key: string }
  | {
      type: "favorite";
      key: string;
      favorite: ShellFavoriteFile;
      hostLabel: string;
      dimmed: boolean;
    }
  | {
      type: "command";
      key: string;
      command: ShellCommand;
      hostLabel: string;
      dimmed: boolean;
      running: boolean;
    }
  | { type: "host"; key: string; section: ShellHostSection }
  | { type: "host-empty"; key: string; label: string }
  | { type: "workspace"; key: string; row: ShellWorkspaceRow; dimmed: boolean };

// 收藏夹区 empty state — until the first 收藏 lands (files screen chip / preview
// star), the card teaches the gesture that fills the section below.
function FavoritesPlaceholder() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.favoritesEmpty} testID="shell-workspace-favorites-empty">
      <Star size={16} color={styles.favoritesEmptyIcon.color} />
      <Text style={styles.favoritesEmptyText}>{t("workspace.favoritesEmpty")}</Text>
    </View>
  );
}

// 空态 (DESIGN §5): no host at all → guide into the official connect flow.
function WorkspaceEmptyState({ onConnectHost }: { onConnectHost: () => void }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.empty} testID="shell-workspace-empty">
      <View style={styles.emptyIconWrap}>
        <FolderTree size={28} color={styles.emptyIcon.color} />
      </View>
      <Text style={styles.emptyTitle}>{t("workspace.emptyTitle")}</Text>
      <Text style={styles.emptyHint}>{t("workspace.emptyHint")}</Text>
      <Button onPress={onConnectHost} testID="shell-empty-connect-host">
        {t("workspace.connectHost")}
      </Button>
    </View>
  );
}

// 文件搜索空态 (C9 + C12): icon + miss line + the honest scope note + 清除搜索;
// the client-side filter only sees directories this app run has browsed (no
// filename-search RPC upstream). With an empty query just the scope note leads.
function FileSearchEmptyState({ searching, onClear }: { searching: boolean; onClear: () => void }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.searchEmpty} testID="shell-workspace-search-empty">
      {searching ? (
        <>
          <View style={styles.emptyIconWrap}>
            <SearchX size={28} color={styles.emptyIcon.color} />
          </View>
          <Text style={styles.emptyTitle}>{t("workspace.searchEmptyTitle")}</Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={onClear}
            testID="shell-workspace-search-clear"
          >
            {t("workspace.searchEmptyAction")}
          </Button>
        </>
      ) : null}
      <Text style={styles.emptyHint}>{t("workspace.searchEmptyHint")}</Text>
    </View>
  );
}

function ActionRow({
  Icon,
  label,
  onPress,
  testID,
}: {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.actionRow, pressed && styles.rowPressed],
    [],
  );
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={rowStyle} testID={testID}>
      <View style={styles.actionIconWrap}>
        <Icon size={16} color={styles.actionIcon.color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function ShellWorkspaceScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const openAddProject = useOpenAddProject();

  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const { projects, isLoading: projectsLoading, refetch } = useProjects();
  const { agents, isInitialLoad, refreshAll } = useAggregatedAgents();

  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useShellHostStatuses(hostIds);
  const hostsById = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host] as const)),
    [hosts],
  );

  const sections = useMemo(
    () => buildWorkspaceTree({ hosts, statuses, projects, agents }),
    [hosts, statuses, projects, agents],
  );

  // C9 文件名搜索: the session-store explorer cache is the index (no filename-search
  // RPC upstream — see shell/search/file-search.ts). Built only while search mode is
  // open; names reuse the tree sections so results label like the tree below.
  const sessions = useSessionStore((state) => state.sessions);
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState("");
  const searchSources = useMemo<FileSearchSource[]>(() => {
    if (!searchActive) return [];
    const names = new Map<string, string>();
    for (const section of sections) {
      for (const row of section.rows) {
        names.set(`${section.serverId}:${row.workspaceId}`, row.name);
      }
    }
    const out: FileSearchSource[] = [];
    for (const [serverId, session] of Object.entries(sessions)) {
      for (const [stateKey, explorer] of session.fileExplorer) {
        // Only workspace-scoped states open in the preview (it needs a
        // workspaceId); the shell only ever creates `workspace:` states anyway.
        if (!stateKey.startsWith("workspace:")) continue;
        const workspaceId = stateKey.slice("workspace:".length);
        const descriptor = session.workspaces.get(workspaceId);
        const entries: FileSearchEntry[] = [];
        for (const directory of explorer.directories.values()) {
          entries.push(...directory.entries);
        }
        out.push({
          serverId,
          hostLabel: hostsById.get(serverId)?.label ?? serverId,
          workspaceId,
          workspaceName:
            names.get(`${serverId}:${workspaceId}`) ??
            descriptor?.projectDisplayName ??
            workspaceId,
          workspaceRoot: descriptor?.workspaceDirectory || descriptor?.projectRootPath || "",
          entries,
        });
      }
    }
    return out;
  }, [searchActive, sessions, sections, hostsById]);
  const searchHits = useMemo(
    () => (searchActive ? searchFileNames(searchSources, query) : []),
    [searchActive, searchSources, query],
  );
  const searching = searchActive && normalizeSearchQuery(query).length > 0;

  const favorites = usePaseoGoFavoritesStore((state) => state.items);
  const commands = usePaseoGoCommandsStore((state) => state.items);
  const { runningId, pickerCommand, requestRun, selectWorkspace, closePicker, remove } =
    useShellCommandRunner();
  const items = useMemo<TreeItem[]>(() => {
    const out: TreeItem[] = [
      { type: "favorites-header", key: "favorites-header" },
      { type: "new-command", key: "new-command" },
    ];
    if (favorites.length === 0 && commands.length === 0) {
      out.push({ type: "favorites-empty", key: "favorites-empty" });
    }
    // 混排 (DESIGN §5): 文件与 ⚡ 快捷指令按各自的加入时间倒序穿插在同一收藏夹区。
    const entries: { at: number; item: TreeItem }[] = [
      ...favorites.map((favorite) => ({
        at: favorite.addedAt,
        item: {
          type: "favorite" as const,
          key: `favorite:${favorite.hostId}:${favorite.path}`,
          favorite,
          hostLabel: hostsById.get(favorite.hostId)?.label ?? favorite.hostId,
          dimmed: (statuses.get(favorite.hostId) ?? "connecting") !== "online",
        },
      })),
      ...commands.map((command) => ({
        at: command.createdAt,
        item: {
          type: "command" as const,
          key: `command:${command.id}`,
          command,
          hostLabel: hostsById.get(command.hostId)?.label ?? command.hostId,
          dimmed: (statuses.get(command.hostId) ?? "connecting") !== "online",
          running: runningId === command.id,
        },
      })),
    ];
    entries.sort((left, right) => right.at - left.at);
    for (const entry of entries) out.push(entry.item);
    for (const section of sections) {
      out.push({ type: "host", key: `host:${section.serverId}`, section });
      if (section.rows.length === 0) {
        out.push({
          type: "host-empty",
          key: `host-empty:${section.serverId}`,
          label: section.isOnline ? t("workspace.hostEmpty") : t("workspace.hostEmptyOffline"),
        });
      }
      for (const row of section.rows) {
        out.push({ type: "workspace", key: `row:${row.key}`, row, dimmed: !section.isOnline });
      }
    }
    return out;
  }, [sections, t, favorites, commands, runningId, hostsById, statuses]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRefresh = useCallback(() => {
    refreshAll();
    refetch();
    setRefreshing(true);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setRefreshing(false), REFRESH_SETTLE_MS);
  }, [refreshAll, refetch]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const handleRetryHost = useCallback(
    (serverId: string) => {
      void getHostRuntimeStore().runProbeCycleNow(serverId);
      toast.show(t("chats.retrying", { label: hostsById.get(serverId)?.label ?? serverId }));
    },
    [hostsById, toast, t],
  );
  const handleOpenSettings = useCallback(
    (serverId: string) => router.push(OFFICIAL.hostSettings(serverId) as Href),
    [],
  );
  const handleNewProject = useCallback(() => openAddProject(), [openAddProject]);
  const handleConnectHost = useCallback(
    () => router.push(OFFICIAL.addHost(Date.now()) as Href),
    [],
  );
  const handleSearchOpen = useCallback(() => setSearchActive(true), []);
  const handleSearchClose = useCallback(() => {
    setSearchActive(false);
    setQuery("");
  }, []);
  const handleOpenHit = useCallback(
    (hit: FileSearchHit) =>
      router.push(
        shellPreviewHref({
          serverId: hit.serverId,
          workspaceId: hit.workspaceId,
          path: hit.path,
          name: hit.name,
          workspaceRoot: hit.workspaceRoot,
        }) as Href,
      ),
    [],
  );
  const renderSearchRow = useCallback(
    ({ item }: { item: FileSearchHit }) => <FileSearchRow hit={item} onOpen={handleOpenHit} />,
    [handleOpenHit],
  );
  const searchKeyExtractor = useCallback((hit: FileSearchHit) => hit.key, []);
  const handleOpenWorkspace = useCallback(
    (row: ShellWorkspaceRow) => router.push(shellFilesHref(row.serverId, row.workspaceId)),
    [],
  );
  const handleNewCommand = useCallback(() => router.push(shellCommandEditHref() as Href), []);
  const handleEditCommand = useCallback(
    (command: ShellCommand) => router.push(shellCommandEditHref(command.id) as Href),
    [],
  );
  const handleRemoveCommand = useCallback(
    (command: ShellCommand) => void remove(command),
    [remove],
  );

  // 项目选择 sheet (workspaceId 缺省): the host's own sections rows, same labels and
  // order the tree below shows — one derivation, no second workspace list.
  const pickerOptions = useMemo<CommandWorkspaceOption[]>(() => {
    if (!pickerCommand) return [];
    const section = sections.find((entry) => entry.serverId === pickerCommand.hostId);
    return (section?.rows ?? []).map((row) => ({
      workspaceId: row.workspaceId,
      name: row.name,
      projectName: row.projectName,
    }));
  }, [sections, pickerCommand]);

  const renderItem = useCallback(
    ({ item }: { item: TreeItem }) => {
      switch (item.type) {
        case "favorites-header":
          return (
            <View style={styles.sectionHeader} testID="shell-workspace-favorites-header">
              <Star size={12} color={styles.sectionHeaderText.color} />
              <Text style={styles.sectionHeaderText}>{t("workspace.favoritesTitle")}</Text>
            </View>
          );
        case "favorites-empty":
          return <FavoritesPlaceholder />;
        case "favorite":
          return (
            <WorkspaceFavoriteRow
              favorite={item.favorite}
              hostLabel={item.hostLabel}
              dimmed={item.dimmed}
            />
          );
        case "new-command":
          return (
            <ActionRow
              Icon={Zap}
              label={t("workspace.newCommand")}
              onPress={handleNewCommand}
              testID="shell-workspace-new-command"
            />
          );
        case "command":
          return (
            <WorkspaceCommandRow
              command={item.command}
              hostLabel={item.hostLabel}
              dimmed={item.dimmed}
              running={item.running}
              onRun={requestRun}
              onEdit={handleEditCommand}
              onRemove={handleRemoveCommand}
            />
          );
        case "host":
          return (
            <WorkspaceHostHeader
              serverId={item.section.serverId}
              label={item.section.label}
              isOnline={item.section.isOnline}
              onOpenSettings={handleOpenSettings}
              onRetry={handleRetryHost}
            />
          );
        case "host-empty":
          return <Text style={styles.hostEmpty}>{item.label}</Text>;
        case "workspace":
          return (
            <WorkspaceProjectRow row={item.row} dimmed={item.dimmed} onOpen={handleOpenWorkspace} />
          );
      }
    },
    [
      handleOpenSettings,
      handleRetryHost,
      handleOpenWorkspace,
      handleNewCommand,
      handleEditCommand,
      handleRemoveCommand,
      requestRun,
      t,
    ],
  );

  const keyExtractor = useCallback((item: TreeItem) => item.key, []);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <ActionRow
          Icon={Plus}
          label={t("workspace.newProject")}
          onPress={handleNewProject}
          testID="shell-workspace-new-project"
        />
        <ActionRow
          Icon={FolderTree}
          label={t("workspace.connectHost")}
          onPress={handleConnectHost}
          testID="shell-workspace-connect-host"
        />
      </View>
    ),
    [t, handleNewProject, handleConnectHost],
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={styles.refreshTint.color}
      />
    ),
    [refreshing, handleRefresh],
  );

  // C12: mask until BOTH the project list and the first agent-directory wave land —
  // otherwise a fast projects response flashes 「暂无项目」 under still-arriving agents.
  const showSkeleton =
    hostRegistryStatus === "loading" || (hosts.length > 0 && (projectsLoading || isInitialLoad));
  const hasHosts = hosts.length > 0;
  // Stable element identity for FlatList (the chats tab's listEmpty idiom).
  const searchListEmpty = useMemo(
    () => <FileSearchEmptyState searching={searching} onClear={handleSearchClose} />,
    [searching, handleSearchClose],
  );

  let body: ReactNode;
  if (searchActive) {
    // 结果替换列表区 (C9 ruling): the tree is fully swapped for the hit list.
    body = (
      <FlatList
        data={searchHits}
        keyExtractor={searchKeyExtractor}
        renderItem={renderSearchRow}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={searchListEmpty}
        testID="shell-workspace-search-results"
      />
    );
  } else if (showSkeleton) {
    body = (
      <View style={styles.skeletonWrap} testID="shell-workspace-skeleton">
        <SidebarAgentListSkeleton />
      </View>
    );
  } else if (hasHosts) {
    body = (
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        refreshControl={refreshControl}
        testID="shell-workspace-list"
      />
    );
  } else {
    body = (
      <View style={styles.emptyWrap}>
        <WorkspaceEmptyState onConnectHost={handleConnectHost} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {searchActive ? (
          <SearchModeBar
            onQueryChange={setQuery}
            onCancel={handleSearchClose}
            placeholder={t("workspace.searchInputPlaceholder")}
            inputTestID="shell-workspace-search-input"
            cancelTestID="shell-workspace-search-cancel"
          />
        ) : (
          <>
            <Text style={styles.title}>{t("workspace.title")}</Text>
            <Pressable
              onPress={handleSearchOpen}
              accessibilityRole="search"
              style={styles.searchBar}
              testID="shell-workspace-search"
            >
              <Search size={15} color={styles.searchIcon.color} />
              <Text style={styles.searchPlaceholder} numberOfLines={1}>
                {t("workspace.searchPlaceholder")}
              </Text>
            </Pressable>
          </>
        )}
      </View>
      {body}
      <CommandWorkspacePickerSheet
        open={pickerCommand !== null}
        options={pickerOptions}
        onSelect={selectWorkspace}
        onClose={closePicker}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[3],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 44,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  searchIcon: {
    color: theme.colors.foregroundMuted,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  searchEmpty: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4] * 4,
    paddingHorizontal: theme.spacing[6],
  },
  listContent: {
    paddingBottom: theme.spacing[8],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
  },
  sectionHeaderText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  favoritesEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[4],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  favoritesEmptyIcon: {
    color: theme.colors.foregroundMuted,
  },
  favoritesEmptyText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  hostEmpty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  footer: {
    paddingTop: theme.spacing[2],
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  actionIconWrap: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: {
    color: theme.colors.accent,
  },
  actionLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accent,
  },
  skeletonWrap: {
    flex: 1,
    paddingTop: theme.spacing[2],
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[2],
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
  },
  emptyTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    marginBottom: theme.spacing[2],
  },
  refreshTint: {
    color: theme.colors.accent,
  },
}));
