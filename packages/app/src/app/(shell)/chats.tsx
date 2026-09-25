// 对话 tab (DESIGN §4, card C2): cross-host flat chat list over every connected
// host's agents. Groups 已置顶 → 需要处理 → 最近, then one greyed group per offline
// host with retry; unread comes from the readState store, pin order from the pins
// store, hiding from the archive store. Cold start shows the official sidebar
// skeleton; pull-to-refresh re-pulls every host directory. Tapping a row pushes the
// official agent route (temporary direct push until C4 rewires it to the workspace
// route + open intent).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MessageCircle } from "lucide-react-native";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { Button } from "@/components/ui/button";
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
import { ChatListRow, type ShellChatAgent } from "@/shell/components/chat-list-row";
import { ChatSectionHeader } from "@/shell/components/chat-section-header";
import { ChatsHeader } from "@/shell/components/chats-header";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL } from "@/shell/routes";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";

const SECTION_TITLE_KEY: Record<Exclude<ChatSectionKind, "offline">, string> = {
  pinned: "chats.section.pinned",
  needs_attention: "chats.section.needsAttention",
  recent: "chats.section.recent",
};

const REFRESH_SETTLE_MS = 700;

// RefreshControl takes colors outside the style system; the withUnistyles mapping is
// the ThemedStack idiom for theme-fed non-style props.
const ThemedRefreshControl = withUnistyles(RefreshControl, (theme) => ({
  tintColor: theme.colors.foregroundMuted,
  colors: [theme.colors.accent],
}));

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
// the guidance is the official connect flow instead.
function ChatsEmptyState({
  hasHosts,
  onNewChat,
  onConnectHost,
}: {
  hasHosts: boolean;
  onNewChat: () => void;
  onConnectHost: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
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

  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useShellHostStatuses(hostIds);
  const hostsById = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host] as const)),
    [hosts],
  );

  // One pass over the directory into derivation inputs; grouping/sorting/unread are
  // the pure derive module's job (and its unit tests' subject).
  const items = useMemo(() => {
    const inputs: ShellChatAgent[] = agents.map((agent) => ({
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
    return flattenChatSections(
      deriveChatSections({
        agents: inputs,
        pinnedIds,
        archivedIds,
        lastReadAt,
        hostIds,
        hostStatuses: statuses,
      }),
    );
  }, [agents, pinnedIds, archivedIds, lastReadAt, hostIds, statuses]);

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
    ({ item }: { item: ChatListItem<ShellChatAgent> }) => {
      if (item.type === "section-header") {
        const { section } = item;
        if (section.kind === "offline" && section.serverId) {
          return (
            <OfflineSectionHeader
              title={hostsById.get(section.serverId)?.label ?? section.serverId}
              serverId={section.serverId}
              onRetry={handleRetryHost}
            />
          );
        }
        if (section.kind !== "offline") {
          return (
            <ChatSectionHeader
              title={t(SECTION_TITLE_KEY[section.kind])}
              testID={`shell-section-${section.kind}`}
            />
          );
        }
        return null;
      }
      return <ChatListRow row={item.row} />;
    },
    [hostsById, handleRetryHost, t],
  );

  const keyExtractor = useCallback((item: ChatListItem<ShellChatAgent>) => item.key, []);
  const refreshControl = useMemo(
    () => <ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />,
    [refreshing, handleRefresh],
  );
  const hasHosts = hosts.length > 0;
  const listEmpty = useMemo(
    () => (
      <ChatsEmptyState
        hasHosts={hasHosts}
        onNewChat={handleNewChat}
        onConnectHost={handleConnectHost}
      />
    ),
    [hasHosts, handleNewChat, handleConnectHost],
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
        />
      </View>
      {showSkeleton ? (
        <View style={styles.skeletonWrap} testID="shell-chats-skeleton">
          <SidebarAgentListSkeleton />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
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
