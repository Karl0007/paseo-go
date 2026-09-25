// 工作区 tab (DESIGN §5, card C5): 搜索框占位 (C9 实装) → 收藏夹区空态占位 (C6/C7
// 填充) → 主机分组 (连接点 + 名称 + ⚙ push 官方 host settings；离线置灰+重试) →
// 项目行 (workspace 名 + 活跃 agent 数角标, 按最近使用排序) → ＋新建项目 (官方
// add-project 流程, C2 顶栏同款) → ＋连接新主机 (官方 welcome). Row taps push the
// shell files route — a C6 placeholder showing the workspace root for now. Cold
// start rides the official skeleton; pull-to-refresh re-pulls agents + directories.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FolderTree, Plus, Search, Star, type LucideIcon } from "lucide-react-native";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useProjects } from "@/hooks/use-projects";
import { getHostRuntimeStore, useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL, shellFilesHref } from "@/shell/routes";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { WorkspaceHostHeader } from "@/shell/components/workspace-host-header";
import { WorkspaceProjectRow } from "@/shell/components/workspace-project-row";
import { WorkspaceFavoriteRow } from "@/shell/components/workspace-favorite-row";
import { usePaseoGoFavoritesStore, type ShellFavoriteFile } from "@/shell/stores/favorites";
import {
  buildWorkspaceTree,
  type ShellHostSection,
  type ShellWorkspaceRow,
} from "@/shell/workspace/derive";

const REFRESH_SETTLE_MS = 700;

type TreeItem =
  | { type: "favorites-header"; key: string }
  | { type: "favorites-empty"; key: string }
  | {
      type: "favorite";
      key: string;
      favorite: ShellFavoriteFile;
      hostLabel: string;
      dimmed: boolean;
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

  const favorites = usePaseoGoFavoritesStore((state) => state.items);
  const items = useMemo<TreeItem[]>(() => {
    const out: TreeItem[] = [{ type: "favorites-header", key: "favorites-header" }];
    if (favorites.length === 0) {
      out.push({ type: "favorites-empty", key: "favorites-empty" });
    }
    for (const favorite of favorites) {
      out.push({
        type: "favorite",
        key: `favorite:${favorite.hostId}:${favorite.path}`,
        favorite,
        hostLabel: hostsById.get(favorite.hostId)?.label ?? favorite.hostId,
        dimmed: (statuses.get(favorite.hostId) ?? "connecting") !== "online",
      });
    }
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
  }, [sections, t, favorites, hostsById, statuses]);

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
  const handleSearchPlaceholder = useCallback(
    () => toast.show(t("workspace.searchSoon")),
    [toast, t],
  );
  const handleOpenWorkspace = useCallback(
    (row: ShellWorkspaceRow) => router.push(shellFilesHref(row.serverId, row.workspaceId)),
    [],
  );

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
    [handleOpenSettings, handleRetryHost, handleOpenWorkspace, t],
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

  const showSkeleton =
    hostRegistryStatus === "loading" || (projectsLoading && isInitialLoad && hosts.length > 0);
  const hasHosts = hosts.length > 0;

  let body: ReactNode;
  if (showSkeleton) {
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
        <Text style={styles.title}>{t("workspace.title")}</Text>
        <Pressable
          onPress={handleSearchPlaceholder}
          accessibilityRole="search"
          style={styles.searchBar}
          testID="shell-workspace-search"
        >
          <Search size={15} color={styles.searchIcon.color} />
          <Text style={styles.searchPlaceholder} numberOfLines={1}>
            {t("workspace.searchPlaceholder")}
          </Text>
        </Pressable>
      </View>
      {body}
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
    height: 38,
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
