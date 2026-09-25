// 对话 tab (DESIGN §4, cards C2+C3): cross-host flat chat list over every connected
// host's agents. Groups 已置顶 → 需要处理 → 最近, then one greyed group per offline
// host with retry; unread comes from the readState store, pin order from the pins
// store, hiding from the archive store. Cold start shows the official sidebar
// skeleton; pull-to-refresh re-pulls every host directory. Tapping a row enters the
// official session through the C4 opener (navigateToAgent: workspace route + open
// intent, never the parse stub) and stamps it read; returning re-stamps the visit.
//
// C3: the list rides the official DraggableList wrapper so the 置顶 group can be
// re-ordered by long-press-drag (only pinned rows arm the drag; the wrapper hides
// the refresh control while a drag is live, the documented coexistence fix). Drops
// persist through shellAgentActions.reorderPinned. The 顶栏 filter segment flips
// between 进行中 and 已归档; the archived view reuses the same derivation with the
// archived set inverted, and its rows carry the 取消归档/删除 menu.
// C9: the header search morphs the bar into an input + 取消; a non-empty query
// filters the derived sections in place (别名/标题/项目名/最后动态, case-insensitive,
// grouping kept — a 置顶 hit stays in 置顶), the empty query restores the full list.
// Drag is inert while searching so a filtered pinned subset can never rewrite the
// pin order (handleDragEnd only sees visible rows).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Archive, MessageCircle, SearchX, WifiOff } from "lucide-react-native";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { Button } from "@/components/ui/button";
import { DraggableList } from "@/components/draggable-list";
import type { DraggableRenderItemInfo } from "@/components/draggable-list.types";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { getHostRuntimeStore, useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import {
  deriveChatSections,
  flattenChatSections,
  type ChatListItem,
  type ChatSectionKind,
} from "@/shell/chats/derive";
import { createChatOpener } from "@/shell/chats/open-agent";
import {
  ACTIVITY_LABEL_KEY,
  ChatListRow,
  type ShellChatAgent,
} from "@/shell/components/chat-list-row";
import { ChatSectionHeader } from "@/shell/components/chat-section-header";
import { ChatsHeader, type ChatListFilter } from "@/shell/components/chats-header";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  chatMatchesQuery,
  filterChatSections,
  type ChatSearchFields,
} from "@/shell/search/chat-filter";
import { normalizeSearchQuery } from "@/shell/search/query";
import { resolveProjectPlacement } from "@/utils/project-placement";
import { OFFICIAL, SHELL } from "@/shell/routes";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { useShellAgentActions } from "@/shell/shellAgentActions";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";

const SECTION_TITLE_KEY: Record<Exclude<ChatSectionKind, "offline">, string> = {
  pinned: "chats.section.pinned",
  needs_attention: "chats.section.needsAttention",
  recent: "chats.section.recent",
};

const REFRESH_SETTLE_MS = 700;

// Greyed offline-host group header: host label + single-host retry.
function OfflineSectionHeader({
  title,
  serverId,
  onRetry,
}: {
  title: string;
  serverId: string;
  onRetry: (serverId: string) => void;
}) {
  const handleRetry = useCallback(() => onRetry(serverId), [onRetry, serverId]);
  return (
    <ChatSectionHeader
      title={title}
      onRetry={handleRetry}
      testID={`shell-section-offline-${serverId}`}
    />
  );
}

// Empty states (DESIGN §4 / C12): every branch is icon + one-line guidance + a
// primary action — 无会话 gets the 新建对话 guidance (the official connect flow when
// no host exists yet), 搜索无结果 offers 清除搜索, 已归档空 offers 切回进行中.
function ChatsEmptyState({
  hasHosts,
  allHostsOffline,
  archivedOnly,
  searching,
  onNewChat,
  onConnectHost,
  onClearSearch,
  onShowActive,
  onRetryAll,
}: {
  hasHosts: boolean;
  /** C12: every host is offline/error and no cached rows remain — the 新建对话
   * guidance would mislead; offer 重试连接 instead (offline hosts without a cached
   * directory are otherwise invisible here). */
  allHostsOffline: boolean;
  archivedOnly: boolean;
  /** C9: the query matched nothing. */
  searching: boolean;
  onNewChat: () => void;
  onConnectHost: () => void;
  onClearSearch: () => void;
  onShowActive: () => void;
  onRetryAll: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  if (searching) {
    return (
      <View style={styles.empty} testID="shell-chats-search-empty">
        <View style={styles.emptyIconWrap}>
          <SearchX size={28} color={styles.emptyIcon.color} />
        </View>
        <Text style={styles.emptyHint}>{t("chats.searchEmpty")}</Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={onClearSearch}
          testID="shell-empty-clear-search"
        >
          {t("chats.searchEmptyAction")}
        </Button>
      </View>
    );
  }
  if (archivedOnly) {
    return (
      <View style={styles.empty} testID="shell-chats-empty-archived">
        <View style={styles.emptyIconWrap}>
          <Archive size={28} color={styles.emptyIcon.color} />
        </View>
        <Text style={styles.emptyHint}>{t("chats.emptyArchived")}</Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={onShowActive}
          testID="shell-empty-show-active"
        >
          {t("chats.emptyArchivedAction")}
        </Button>
      </View>
    );
  }
  if (allHostsOffline) {
    return (
      <View style={styles.empty} testID="shell-chats-empty-offline">
        <View style={styles.emptyIconWrap}>
          <WifiOff size={28} color={styles.emptyIcon.color} />
        </View>
        <Text style={styles.emptyTitle}>{t("chats.offlineTitle")}</Text>
        <Text style={styles.emptyHint}>{t("chats.offlineHint")}</Text>
        <Button onPress={onRetryAll} testID="shell-empty-retry-all">
          {t("chats.retryAll")}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.empty} testID="shell-chats-empty">
      <View style={styles.emptyIconWrap}>
        <MessageCircle size={28} color={styles.emptyIcon.color} />
      </View>
      <Text style={styles.emptyTitle}>{t("chats.emptyTitle")}</Text>
      <Text style={styles.emptyHint}>
        {hasHosts ? t("chats.emptyAgentsHint") : t("chats.emptyHostsHint")}
      </Text>
      {hasHosts ? (
        <Button onPress={onNewChat} testID="shell-empty-new-chat">
          {t("chats.newChat")}
        </Button>
      ) : (
        <Button variant="secondary" onPress={onConnectHost} testID="shell-empty-connect">
          {t("chats.connectHost")}
        </Button>
      )}
    </View>
  );
}

// C9 search haystack for one row: the alias (shell rename) plus the texts the row
// renders — official title, project name, translated 最后动态 label. Matching rules
// live in the pure chat-filter module.
function searchFieldsFor(
  agent: ShellChatAgent,
  aliases: Readonly<Record<string, string>>,
  t: (key: string) => string,
): ChatSearchFields {
  const activityKey = ACTIVITY_LABEL_KEY[agent.bucket];
  return {
    alias: aliases[agent.key],
    title: agent.agent.title,
    projectName: resolveProjectPlacement({
      projectPlacement: agent.agent.projectPlacement,
      cwd: agent.agent.cwd,
    }).projectName,
    activityLabel: activityKey ? t(activityKey) : null,
  };
}

export default function ShellChatsScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const openAddProject = useOpenAddProject();

  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const { agents, isInitialLoad, refreshAll } = useAggregatedAgents();

  const pinnedIds = usePaseoGoPinsStore((state) => state.pinnedIds);
  const aliases = usePaseoGoPinsStore((state) => state.aliases);
  const archivedIds = usePaseoGoArchiveStore((state) => state.archivedIds);
  const lastReadAt = usePaseoGoReadStateStore((state) => state.lastReadAt);
  const markRead = usePaseoGoReadStateStore((state) => state.markRead);

  const actions = useShellAgentActions();

  // C4: row taps enter the session through the official navigateToAgent tool family
  // (workspace route + open intent) with a push verb (the official dismissTo pops the
  // list → back exits the app; the parse stub flashes white, SPIKE A2). The opener
  // stamps read on entry and again when this screen regains focus, so a reply watched
  // inside the session never resurfaces as an unread dot.
  const opener = useMemo(
    () => createChatOpener({ markRead, navigateToAgent: shellNavigateToAgent, now: Date.now }),
    [markRead],
  );
  const handleOpenChat = useCallback(
    (agent: ShellChatAgent) =>
      opener.open({
        key: agent.key,
        serverId: agent.serverId,
        agentId: agent.agent.id,
        workspaceId: agent.agent.workspaceId,
      }),
    [opener],
  );
  useFocusEffect(
    useCallback(() => {
      opener.onFocus();
      return undefined;
    }, [opener]),
  );

  const [filter, setFilter] = useState<ChatListFilter>("active");
  const archivedOnly = filter === "archived";

  // C9 search mode: the header owns the input, the screen owns the query. The
  // normalised form drives filtering; empty means “no filter” (restore-on-clear).
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearchQuery(query);

  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useShellHostStatuses(hostIds);
  const hostsById = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host] as const)),
    [hosts],
  );
  const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds]);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  // One pass over the directory into derivation inputs; grouping/sorting/unread are
  // the pure derive module's job (and its unit tests' subject). The archived filter
  // inverts the membership: only archived rows enter, and neither the pin group nor
  // the hiding rule applies to them.
  const items = useMemo(() => {
    let inputs: ShellChatAgent[] = agents.map((agent) => ({
      key: `${agent.serverId}:${agent.id}`,
      serverId: agent.serverId,
      lastActivityAt: agent.lastActivityAt.getTime(),
      attentionTimestamp: agent.attentionTimestamp ? agent.attentionTimestamp.getTime() : null,
      bucket: deriveSidebarStateBucket({
        status: agent.status,
        requiresAttention: Boolean(agent.requiresAttention),
        attentionReason: agent.attentionReason ?? null,
        pendingPermissionCount: agent.pendingPermissionCount ?? 0,
      }),
      agent,
    }));
    if (archivedOnly) inputs = inputs.filter((agent) => archivedSet.has(agent.key));
    const sections = deriveChatSections({
      agents: inputs,
      pinnedIds: archivedOnly ? [] : pinnedIds,
      archivedIds: archivedOnly ? [] : archivedIds,
      lastReadAt,
      hostIds,
      hostStatuses: statuses,
    });
    // C9: a live query narrows the derived sections in place; empty restores.
    if (normalizedQuery.length === 0) return flattenChatSections(sections);
    return flattenChatSections(
      filterChatSections(sections, (agent) =>
        chatMatchesQuery(searchFieldsFor(agent, aliases, t), normalizedQuery),
      ),
    );
  }, [
    agents,
    archivedOnly,
    archivedSet,
    pinnedIds,
    archivedIds,
    lastReadAt,
    hostIds,
    statuses,
    normalizedQuery,
    aliases,
    t,
  ]);

  const archivedCount = useMemo(
    () => agents.filter((agent) => archivedSet.has(`${agent.serverId}:${agent.id}`)).length,
    [agents, archivedSet],
  );

  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRefresh = useCallback(() => {
    refreshAll();
    setRefreshing(true);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setRefreshing(false), REFRESH_SETTLE_MS);
  }, [refreshAll]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  // The library hands back the whole list reordered; only the pinned rows' relative
  // order is its opinion we keep — headers and unpinned rows are re-derived anyway.
  const handleDragEnd = useCallback(
    (nextItems: ChatListItem<ShellChatAgent>[]) => {
      // C9: while a query narrows the list, handleDragEnd only sees the visible
      // subset — persisting it would drop the hidden pins. Drag is also disabled
      // in renderItem, so this is the belt to that braces.
      if (normalizedQuery.length > 0) return;
      const order: string[] = [];
      for (const item of nextItems) {
        if (item.type === "row" && pinnedSet.has(item.row.agent.key))
          order.push(item.row.agent.key);
      }
      actions.reorderPinned(order);
    },
    [actions, pinnedSet, normalizedQuery],
  );

  const handleRetryHost = useCallback(
    (serverId: string) => {
      void getHostRuntimeStore().runProbeCycleNow(serverId);
      toast.show(t("chats.retrying", { label: hostsById.get(serverId)?.label ?? serverId }));
    },
    [hostsById, toast, t],
  );
  const handleNewChat = useCallback(() => openAddProject(), [openAddProject]);
  const handleConnectHost = useCallback(() => router.push(OFFICIAL.welcome as Href), []);
  const handleSearchOpen = useCallback(() => setSearchActive(true), []);
  const handleSearchClose = useCallback(() => {
    setSearchActive(false);
    setQuery("");
  }, []);
  const handleImportChat = useCallback(() => router.push(SHELL.import as Href), []);
  const handleShowActive = useCallback(() => setFilter("active"), []);

  const renderItem = useCallback(
    ({ item, drag, isActive }: DraggableRenderItemInfo<ChatListItem<ShellChatAgent>>) => {
      if (item.type === "section-header") {
        const { section } = item;
        if (section.kind === "offline") {
          // derive only emits offline groups with a serverId; the guard keeps the
          // types honest and the empty cell is unreachable.
          if (!section.serverId) return <View />;
          return (
            <OfflineSectionHeader
              title={hostsById.get(section.serverId)?.label ?? section.serverId}
              serverId={section.serverId}
              onRetry={handleRetryHost}
            />
          );
        }
        return (
          <ChatSectionHeader
            title={t(SECTION_TITLE_KEY[section.kind])}
            testID={`shell-section-${section.kind}`}
          />
        );
      }
      const draggable = !archivedOnly && !searchActive && pinnedSet.has(item.row.agent.key);
      return (
        <ChatListRow
          row={item.row}
          actions={actions}
          onOpen={handleOpenChat}
          draggable={draggable}
          drag={draggable ? drag : undefined}
          isActive={isActive}
        />
      );
    },
    [actions, archivedOnly, searchActive, handleOpenChat, hostsById, handleRetryHost, pinnedSet, t],
  );

  const keyExtractor = useCallback((item: ChatListItem<ShellChatAgent>) => item.key, []);
  const hasHosts = hosts.length > 0;
  const allHostsOffline =
    hasHosts && hosts.every((host) => (statuses.get(host.serverId) ?? "idle") !== "online");
  const searching = searchActive && normalizedQuery.length > 0;
  const handleRetryAll = useCallback(() => {
    for (const host of hosts) void getHostRuntimeStore().runProbeCycleNow(host.serverId);
    toast.show(t("chats.retryingAll", { count: hosts.length }));
  }, [hosts, toast, t]);
  const listEmpty = useMemo(
    () => (
      <ChatsEmptyState
        hasHosts={hasHosts}
        allHostsOffline={allHostsOffline}
        archivedOnly={archivedOnly}
        searching={searching}
        onNewChat={handleNewChat}
        onConnectHost={handleConnectHost}
        onClearSearch={handleSearchClose}
        onShowActive={handleShowActive}
        onRetryAll={handleRetryAll}
      />
    ),
    [
      archivedOnly,
      hasHosts,
      allHostsOffline,
      searching,
      handleNewChat,
      handleConnectHost,
      handleSearchClose,
      handleShowActive,
      handleRetryAll,
    ],
  );

  const showSkeleton = isInitialLoad || hostRegistryStatus === "loading";

  return (
    <View style={styles.screen}>
      <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
        <ChatsHeader
          hosts={hosts}
          statuses={statuses}
          onRetryHost={handleRetryHost}
          onNewChat={handleNewChat}
          onImportChat={handleImportChat}
          onConnectHost={handleConnectHost}
          onSearch={handleSearchOpen}
          searchActive={searchActive}
          onQueryChange={setQuery}
          onSearchClose={handleSearchClose}
          filter={filter}
          onFilterChange={setFilter}
          archivedCount={archivedCount}
        />
      </View>
      {showSkeleton ? (
        <View style={styles.skeletonWrap} testID="shell-chats-skeleton">
          <SidebarAgentListSkeleton />
        </View>
      ) : (
        <DraggableList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onDragEnd={handleDragEnd}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ListEmptyComponent={listEmpty}
          testID="shell-chats-list"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  headerWrap: {
    backgroundColor: theme.colors.surface0,
    paddingTop: theme.spacing[2],
  },
  skeletonWrap: {
    flex: 1,
    paddingHorizontal: theme.spacing[2],
  },
  listContent: {
    paddingBottom: theme.spacing[8],
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4] * 6,
    paddingHorizontal: theme.spacing[6],
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    marginBottom: theme.spacing[2],
  },
  emptyIcon: {
    color: theme.colors.foregroundExtraMuted,
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
    marginBottom: theme.spacing[3],
  },
}));
