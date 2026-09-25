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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { MessageCircle } from "lucide-react-native";
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
import { ChatListRow, type ShellChatAgent } from "@/shell/components/chat-list-row";
import { ChatSectionHeader } from "@/shell/components/chat-section-header";
import { ChatsHeader, type ChatListFilter } from "@/shell/components/chats-header";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL } from "@/shell/routes";
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

// Empty state (DESIGN §4): illustration + 新建对话 guidance; with no hosts configured
// the guidance is the official connect flow instead. The archived filter gets a plain
// quiet line instead — there is nothing to create from an empty archive.
function ChatsEmptyState({
  hasHosts,
  archivedOnly,
  onNewChat,
  onConnectHost,
}: {
  hasHosts: boolean;
  archivedOnly: boolean;
  onNewChat: () => void;
  onConnectHost: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  if (archivedOnly) {
    return (
      <View style={styles.empty} testID="shell-chats-empty-archived">
        <Text style={styles.emptyHint}>{t("chats.emptyArchived")}</Text>
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
        <Pressable onPress={onConnectHost} accessibilityRole="button" testID="shell-empty-connect">
          <Text style={styles.emptyLink}>{t("chats.connectHost")}</Text>
        </Pressable>
      )}
    </View>
  );
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
    return flattenChatSections(
      deriveChatSections({
        agents: inputs,
        pinnedIds: archivedOnly ? [] : pinnedIds,
        archivedIds: archivedOnly ? [] : archivedIds,
        lastReadAt,
        hostIds,
        hostStatuses: statuses,
      }),
    );
  }, [agents, archivedOnly, archivedSet, pinnedIds, archivedIds, lastReadAt, hostIds, statuses]);

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
      const order: string[] = [];
      for (const item of nextItems) {
        if (item.type === "row" && pinnedSet.has(item.row.agent.key))
          order.push(item.row.agent.key);
      }
      actions.reorderPinned(order);
    },
    [actions, pinnedSet],
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
  const handleSearchPlaceholder = useCallback(() => toast.show(t("chats.searchSoon")), [toast, t]);
  const handleImportPlaceholder = useCallback(() => toast.show(t("chats.importSoon")), [toast, t]);

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
      const draggable = !archivedOnly && pinnedSet.has(item.row.agent.key);
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
    [actions, archivedOnly, handleOpenChat, hostsById, handleRetryHost, pinnedSet, t],
  );

  const keyExtractor = useCallback((item: ChatListItem<ShellChatAgent>) => item.key, []);
  const hasHosts = hosts.length > 0;
  const listEmpty = useMemo(
    () => (
      <ChatsEmptyState
        hasHosts={hasHosts}
        archivedOnly={archivedOnly}
        onNewChat={handleNewChat}
        onConnectHost={handleConnectHost}
      />
    ),
    [archivedOnly, hasHosts, handleNewChat, handleConnectHost],
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
          onImportChat={handleImportPlaceholder}
          onSearch={handleSearchPlaceholder}
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
  emptyLink: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accent,
  },
}));
