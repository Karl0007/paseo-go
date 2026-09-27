// 对话 screen body (C31 extraction, C16 files-screen-body pattern): the whole 对话 tab
// UI — header + draggable list — lifted out of (shell)/chats.tsx so the tablet split
// can host a second instance in its left column. The thin route screen renders this
// verbatim on compact (zero-change tree, §6); when the split is active it renders the
// detail placeholder and the column mounts this component instead.
//
// Because the column lives OUTSIDE every navigator, two things moved off navigator
// hooks onto module buses (the rail-events posture): the C18 双拍 focus beat arrives
// through the section-focus bus (the tab screen emits on real focus, placeholder or
// body), and the §4-8 rail retap scrolls through rail-events. The chats 回顶 remounts
// the list by key — the official DraggableList wrapper exposes no scroll ref (official
// file, out of bounds) and the remount is the only ref-less path to the top; every
// piece of state ABOVE the list (filter, search, refresh) lives here and survives.
//
// --- original screen notes (unchanged behaviour, cards C2-C20) ---
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
// C20 (DESIGN §14.4): every live-filter row rides the drag layer through the
// arbitration hook (long-press → anchored window → sliding past the relay slop
// closes it and lifts the row in ONE touch stream). Drop semantics branch on what
// was dragged: a pinned row re-orders inside the 置顶 group (C3, reorderPinned);
// an unpinned row PINS itself and inserts at the drop slot (pins.pinAt with the
// pinnedDropIndex group-offset conversion, clamped to the group).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Archive, MessageCircle, SearchX, WifiOff } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { Button } from "@/components/ui/button";
import { DraggableList } from "@/components/draggable-list";
import type { DraggableRenderItemInfo } from "@/components/draggable-list.types";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { getHostRuntimeStore, useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  chatLastEventAt,
  chatLastEventAtFromAgent,
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
import { pinnedDropIndex, usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { useShellAgentActions } from "@/shell/shellAgentActions";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { subscribeSectionFocus } from "@/shell/section-focus";
import { subscribeRailRetap } from "@/shell/tablet/rail-events";
import type { ShellScreenBodyProps } from "./shell-screen-body-props";

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

export function ChatsScreenBody({ selectedAgentKey = null }: ShellScreenBodyProps) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();

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
  // inside the session never resurface as an unread dot. F4: both beats stamp with
  // the chat's own host-domain last-event time, never the device wall clock.
  // C24: an imported chat's FIRST open passes the fork warning (official confirm
  // dialog); confirming persists a per-row ack in the forkAck store, cancelling
  // leaves the list untouched (no read stamp — the user never entered).
  const opener = useMemo(
    () =>
      createChatOpener({
        markRead,
        navigateToAgent: shellNavigateToAgent,
        lastEventAtOf: (serverId, agentId) => {
          const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
          return agent ? chatLastEventAtFromAgent(agent) : undefined;
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
      }),
    [markRead, t],
  );
  const handleOpenChat = useCallback(
    (agent: ShellChatAgent) =>
      opener.open({
        key: agent.key,
        serverId: agent.serverId,
        agentId: agent.agent.id,
        workspaceId: agent.agent.workspaceId,
        lastEventAt: chatLastEventAt(agent),
        imported: isImportedProviderSession(agent.agent),
      }),
    [opener],
  );
  // C31: the C18 second beat used to ride this screen's useFocusEffect. The body now
  // lives outside the navigator on wide screens, so the tab screen emits the focus
  // beat onto the section bus and it lands here in BOTH positions (compact included
  // — the trigger point is the same real focus event; the beat itself is a no-op
  // unless a visit is pending, so the extra beats the old [opener]-dep re-arm used
  // to fire on language switches carry no semantics).
  useEffect(() => subscribeSectionFocus("chats", () => opener.onFocus()), [opener]);

  // C31 §4-8: rail retap = 回顶. The official DraggableList exposes no scroll ref,
  // so chats remounts the list by key (see header note); filter/search live above.
  const [listNonce, setListNonce] = useState(0);
  useEffect(
    () =>
      subscribeRailRetap((section) => {
        if (section === "chats") setListNonce((nonce) => nonce + 1);
      }),
    [],
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

  // C20: the row the arbitration hook lifted this gesture — recorded in the same
  // frame as drag(), consumed when the drop lands.
  const draggedKeyRef = useRef<string | null>(null);
  const handleRowDragStart = useCallback((key: string) => {
    draggedKeyRef.current = key;
  }, []);

  // C20 device finding #2: the native ScrollView steals a vertical drag at
  // ~12-20px, before the movement-based drag() can lift the row (the pre-C20
  // C3 recipe loses the same race on the current build). While a row gesture
  // is armed (180ms stationary — a real scroll never pauses first), the screen
  // freezes list scrolling; the hook releases the lock with the touch stream.
  const [gestureLock, setGestureLock] = useState(false);

  // The library hands back the whole list reordered; only the pinned rows' relative
  // order is its opinion we keep — headers and unpinned rows are re-derived anyway.
  const handleDragEnd = useCallback(
    (nextItems: ChatListItem<ShellChatAgent>[]) => {
      // C9: while a query narrows the list, handleDragEnd only sees the visible
      // subset — persisting it would drop the hidden pins. Drag is also disabled
      // in renderItem, so this is the belt to that braces.
      if (normalizedQuery.length > 0) return;
      const droppedKey = draggedKeyRef.current;
      draggedKeyRef.current = null;
      const visibleRowKeys: string[] = [];
      for (const item of nextItems) {
        if (item.type === "row") visibleRowKeys.push(item.row.agent.key);
      }
      if (droppedKey !== null && !pinnedSet.has(droppedKey)) {
        // C20: an unpinned row dropped anywhere pins itself and inserts at the
        // drop slot; a drop past either group edge clamps to that edge.
        const index = pinnedDropIndex({ droppedKey, visibleRowKeys, pinnedIds });
        usePaseoGoPinsStore.getState().pinAt(droppedKey, index);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        toast.show(t("chats.toast.pinned"));
        return;
      }
      // C3 in-group reorder, unchanged — and the belt for a drag-end that ever
      // arrives without a recorded drag-start: the visible pinned rows in their
      // new relative order.
      actions.reorderPinned(visibleRowKeys.filter((key) => pinnedSet.has(key)));
    },
    [actions, pinnedSet, pinnedIds, normalizedQuery, toast, t],
  );

  const handleRetryHost = useCallback(
    (serverId: string) => {
      void getHostRuntimeStore().runProbeCycleNow(serverId);
      toast.show(t("chats.retrying", { label: hostsById.get(serverId)?.label ?? serverId }));
    },
    [hostsById, toast, t],
  );
  const handleConnectHost = useCallback(() => router.push(OFFICIAL.welcome as Href), []);
  // C17 (DESIGN §14.7): 新建对话 goes straight to the official New Workspace screen —
  // the add-project flow stays behind the 工作区 tab's ＋新建项目. serverId comes from
  // the R1-safe per-host status read: first online host, else the first host (the
  // screen renders its own offline state), else the connect-host guidance, which is
  // what the no-host empty state does anyway.
  const handleNewChat = useCallback(() => {
    const serverId = hostIds.find((id) => statuses.get(id) === "online") ?? hostIds[0] ?? undefined;
    if (serverId === undefined) {
      handleConnectHost();
      return;
    }
    router.push(OFFICIAL.newWorkspace(serverId));
  }, [hostIds, statuses, handleConnectHost]);
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
      // C20: every live-filter row can drag (an unpinned drop pins at the slot);
      // the archived filter and search mode stay drag-inert (C9 discipline).
      const draggable = !archivedOnly && !searchActive;
      return (
        <ChatListRow
          row={item.row}
          actions={actions}
          onOpen={handleOpenChat}
          draggable={draggable}
          drag={draggable ? drag : undefined}
          onDragStart={handleRowDragStart}
          onGestureLockChange={setGestureLock}
          isActive={isActive}
          selected={item.row.agent.key === selectedAgentKey}
        />
      );
    },
    [
      actions,
      archivedOnly,
      searchActive,
      handleOpenChat,
      handleRowDragStart,
      setGestureLock,
      hostsById,
      handleRetryHost,
      selectedAgentKey,
      t,
    ],
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
          key={listNonce}
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onDragEnd={handleDragEnd}
          scrollEnabled={!gestureLock}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ListEmptyComponent={listEmpty}
          extraData={selectedAgentKey}
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
