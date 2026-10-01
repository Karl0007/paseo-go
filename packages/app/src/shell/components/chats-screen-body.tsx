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
// host's agents. Groups 已置顶 → 最近 (B4-ROW ruling 1: the 需要处理 queue-jump group
// is gone — waiting-for-approval is an inline red mark on the row), then one greyed
// group per offline host with retry; unread comes from the readState store, pin order
// from the pins store, hiding from the archive store. Cold start shows the official sidebar
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
// closes it and lifts the row in ONE touch stream). KI-11 ruling ④ rewrites the
// drop semantics on the zone boundary: a pinned row dragged OUT of 置顶 unpins
// through the SAME actions.unpin the menu button uses; an unpinned row dragged
// INTO the group pins at the drop slot through actions.pin(target, index); an
// in-group move reorders (C3); a move inside the time-derived zone persists
// nothing (`decidePinDrop` + `dispatchPinDrop`, chats/drag-drop.ts). KI-11
// ruling ③ gates the refresh control off for the whole row-gesture band, so a
// long-pressed downward drag at the list top sorts instead of refreshing.
// B4-SWIPE (批次四 F5 裁定 10): the list area also answers a horizontal swipe —
// 进行中 ↔ 已归档. The swipe is not a second state machine: it calls the SAME
// `setFilter` the header's segment presses, and the page turn is one surface
// translating (chats/filter-swipe.ts + chats/use-chats-filter-swipe.ts). The gate
// that keeps a live 置顶 drag from turning the page is `gestureLock` read as a
// shared value inside the worklet — never a flipped DraggableList prop.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Archive, MessageCircle, SearchX, WifiOff } from "lucide-react-native";
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
  finiteTimeMs,
  flattenChatSections,
  type ChatListItem,
  type ChatSectionKind,
} from "@/shell/chats/derive";
import { createChatOpener } from "@/shell/chats/open-agent";
import { OWNERSHIP_OPEN_DIALOG_KEYS, OWNERSHIP_SEND_BODY_KEY } from "@/shell/chats/ownership";
import { chatGestureBandProps, decidePinDrop, dispatchPinDrop } from "@/shell/chats/drag-drop";
import {
  FILTER_SWIPE_PAGE_ARCHIVED,
  filterSwipePageForArchived,
  type FilterSwipePage,
} from "@/shell/chats/filter-swipe";
import { useChatsFilterSwipe } from "@/shell/chats/use-chats-filter-swipe";
import { useChatsFilterJump } from "@/shell/chats/use-chats-filter-jump";
import {
  ACTIVITY_LABEL_KEY,
  ChatListRow,
  type ShellChatAgent,
} from "@/shell/components/chat-list-row";
import { ChatSectionHeader } from "@/shell/components/chat-section-header";
import { createDragLockHandoff } from "@/shell/components/use-shell-row-drag-menu";
import { ChatsHeader, type ChatListFilter } from "@/shell/components/chats-header";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  chatMatchesQuery,
  filterChatSections,
  type ChatSearchFields,
} from "@/shell/search/chat-filter";
import { normalizeSearchQuery } from "@/shell/search/query";
import { useShellSearchBackPriority } from "@/shell/search/use-shell-search-back-priority";
import { resolveProjectPlacement } from "@/utils/project-placement";
import { DETAIL, OFFICIAL, SHELL_TAB } from "@/shell/routes";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoStickyPreviewStore } from "@/shell/stores/stickyPreview";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { useShellAgentActions, type ShellChatTarget } from "@/shell/shellAgentActions";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { subscribeSectionFocus } from "@/shell/section-focus";
import { subscribeRailRetap } from "@/shell/tablet/rail-events";
import type { ShellScreenBodyProps } from "./shell-screen-body-props";

// B4-ROW ruling 1: 需要处理 is no longer a group (the mark is inline on the row),
// so the section-title map only covers the two online groups that still exist.
const SECTION_TITLE_KEY: Record<Exclude<ChatSectionKind, "offline">, string> = {
  pinned: "chats.section.pinned",
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

  // B5-SUB (F13): fold every non-blank directory preview into the shell's
  // keep-old-value store (blank never clears — the store guards that itself).
  // The row falls back to this memory whenever the directory goes blank on a
  // pre-B4 record, so pull-to-refresh / tab revalidation / daemon restart can
  // never wipe a subtitle the list has already shown.
  const rememberPreview = usePaseoGoStickyPreviewStore((state) => state.remember);
  useEffect(() => {
    for (const agent of agents) {
      rememberPreview(`${agent.serverId}:${agent.id}`, agent.lastMessagePreview);
    }
  }, [agents, rememberPreview]);

  // C4: row taps enter the session through the official navigateToAgent tool family
  // (workspace route + open intent) with a push verb (the official dismissTo pops the
  // list → back exits the app; the parse stub flashes white, SPIKE A2). The opener
  // stamps read on entry and records the visit on the module ledger (R2-02); the
  // return stamp settles at the leave moments — rail section switch, the next open,
  // or this screen's focus beat as compensation (R2-03). F4: both beats stamp with
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
          // R2-14: null (garbage host dates) maps to undefined = "no fresh
          // watermark"; the opener keeps its pending visit, never writes NaN.
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
        // B4-R4OPEN (裁定 18): external·运行中 row → graded confirm BEFORE the open
        // (the resume-on-open IS the concurrent-spawn moment). Same copy as the
        // send guard; 取消 leaves the row on the list untouched.
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
  const handleOpenChat = useCallback(
    (agent: ShellChatAgent) =>
      opener.open({
        key: agent.key,
        serverId: agent.serverId,
        agentId: agent.agent.id,
        workspaceId: agent.agent.workspaceId,
        lastEventAt: chatLastEventAt(agent),
        imported: isImportedProviderSession(agent.agent),
        ownership: agent.agent.ownership,
        externalLooksActive: agent.agent.externalLooksActive,
        provider: agent.agent.provider,
      }),
    [opener],
  );
  // C31: the C18 second beat used to ride this screen's useFocusEffect. The body now
  // lives outside the navigator on wide screens, so the tab screen emits the focus
  // beat onto the section bus and it lands here in BOTH positions (compact included
  // — the trigger point is the same real focus event). R2-03 re-scoped the beat to
  // a compensation settle on the module ledger: leave moments (rail switch, the
  // next open) normally drain the slots first, so this clears nothing unless a
  // slot survived one (directory row absent at the leave moment).
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

  // B4-IMPORT (批次四 F7 裁定 12) + R4-17: 导入屏「已归档」徽标行跳转的消费端
  // 收拢在 useChatsFilterJump——切页走本屏唯一 setFilter（segment/横滑也是它），
  // highlightKey 把目标行标成一次性高亮（复用 C31 `selected` 样式，1.2s 自熄），
  // nonce 折进列表 key=免 ref 的归顶原语（rail 重复点回顶同款；官方 DraggableList
  // 包装不透出 scroll ref，见头注——这是本列表唯一能把视口放到已知位置的途径）。
  const jump = useChatsFilterJump(setFilter);

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

  // B5-REVIEW A4: previews of chats deleted on ANOTHER device never fire the
  // local remove (shellAgentActions.forget), so they used to persist forever.
  // Fold-time prune, gated HERE where the observation is known:
  //   • a tick is a change of the aggregated directory (`agents` identity) —
  //     host-status flips must not count, or the N>=2 guard shortens;
  //   • an empty aggregate is never complete (initial load / every host
  //     reconnecting — the blank wave B5-SUB survives must not also wipe the
  //     memory it survives with);
  //   • only servers ONLINE at the tick observed their directory; an offline
  //     host's rows are legitimately absent, so its keys neither count nor
  //     reset (multi-host: host B refreshing cannot prune host A's previews
  //     while A sleeps).
  // statuses/hostIds ride a ref precisely so they do NOT re-trigger the fold
  // (render-phase mirror = the hook's releaseRef pattern).
  const pruneAbsentPreviews = usePaseoGoStickyPreviewStore((state) => state.pruneAbsent);
  const directoryObservationRef = useRef({ hostIds, statuses });
  directoryObservationRef.current = { hostIds, statuses };
  useEffect(() => {
    const present = new Set<string>();
    for (const agent of agents) {
      present.add(`${agent.serverId}:${agent.id}`);
    }
    const { hostIds: tickHostIds, statuses: tickStatuses } = directoryObservationRef.current;
    const observedServers = new Set(
      tickHostIds.filter((serverId) => tickStatuses.get(serverId) === "online"),
    );
    pruneAbsentPreviews({
      complete: present.size > 0,
      present,
      // Key prefix = serverId (keys are built `${serverId}:${agentId}`); a
      // malformed split matches no observed server — the fail-safe direction
      // (never prune what we cannot attribute).
      isServerObserved: (key) => observedServers.has(key.slice(0, key.lastIndexOf(":"))),
    });
  }, [agents, pruneAbsentPreviews]);

  // One pass over the directory into derivation inputs; grouping/sorting/unread are
  // the pure derive module's job (and its unit tests' subject). The archived filter
  // inverts the membership: only archived rows enter, and neither the pin group nor
  // the hiding rule applies to them.
  const items = useMemo(() => {
    let inputs: ShellChatAgent[] = agents.map((agent) => ({
      key: `${agent.serverId}:${agent.id}`,
      serverId: agent.serverId,
      lastActivityAt: finiteTimeMs(agent.lastActivityAt) ?? 0,
      attentionTimestamp: finiteTimeMs(agent.attentionTimestamp),
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
  // R4-09 + B5-NOREFRESH (F15): the band, as a REF. Android's SwipeRefreshLayout
  // intercepts a downward pull at the scroll top even with `scrollEnabled=false`
  // (it only asks `canChildScrollUp()`), and removing `onRefresh` to suppress it
  // is exactly the F10 remount. PRIMARY suppression is now native: the band's
  // `refreshEnabled=false` (gestureBand below → DraggableList's
  // refreshControlEnabled) disables SwipeRefreshLayout itself — no intercept, no
  // spinner, no callback — for the whole armed → menu → drag band. This swallow
  // is the SECOND line of defense for what the disable can't cover: iOS (whose
  // RefreshControl ignores `enabled`) and a pull whose native interception beat
  // the prop commit — either way the reload still never fires while a row
  // gesture owns the touch. The ref (not state) keeps `handleRefresh`'s identity
  // stable: churning the RefreshControl's onRefresh prop is a shape change (F10).
  const gestureLiveRef = useRef(false);
  const handleRefresh = useCallback(() => {
    const swallowed = gestureLiveRef.current;
    if (!swallowed) refreshAll();
    // A swallowed pull still needs its spinner put back down: the control raises
    // its own before JS hears the event, and RN only calls native `setRefreshing`
    // when the prop CHANGES — so the true→false cycle IS the reconciliation
    // (settling immediately instead of after REFRESH_SETTLE_MS).
    setRefreshing(true);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(
      () => setRefreshing(false),
      swallowed ? 0 : REFRESH_SETTLE_MS,
    );
  }, [refreshAll]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  // C20: the row the arbitration hook lifted this gesture — recorded in the same
  // frame as drag(), consumed when the drop lands.
  //
  // R2-01: that same frame hands back the row's scroll-lock release. Once the
  // native drag layer takes the touch over, the JS press_out never arrives, so
  // the drop handler is the ONLY guaranteed end of the gesture — without this
  // the list stays frozen (scrollEnabled=false) for the rest of the session.
  const dragLockHandoff = useRef(createDragLockHandoff()).current;
  const draggedKeyRef = useRef<string | null>(null);
  const handleRowDragStart = useCallback(
    (key: string, releaseGestureLock: () => void) => {
      draggedKeyRef.current = key;
      dragLockHandoff.record(releaseGestureLock);
    },
    [dragLockHandoff],
  );

  // B5-REVIEW A1 (批次五 review): a drag CANCELLED after drag() landed (RNGH's
  // pan failed mid-drag — app backgrounded, system interrupt, another
  // recognizer stole the stream; activation rejected; list unmounted) never
  // runs the drop handler, and B5-F15 made press_out inert in `dragging` — so
  // without a cancel seam the band stranded: scrollEnabled=false, refresh
  // disabled, the swipe gate up, until the next touch on a draggable row
  // self-healed the machine. Device red frame (evidence/B5-REVIEW/A1):
  // background the app mid-drag → foreground → every scroll eaten
  // (a1-31/a1-32; the trace shows `lib onDragCancel` fire with NO lock
  // release). The patched library's onDragTerminate is that signal — release
  // through the SAME consume-once handoff the drop uses, so a real drop that
  // still lands afterwards is inert, and a terminate without a recorded drag
  // (the drag-inert belt) is inert too.
  const handleDragTerminate = useCallback(() => {
    dragLockHandoff.release();
  }, [dragLockHandoff]);

  // C20 device finding #2: the native ScrollView steals a vertical drag at
  // ~12-20px, before the movement-based drag() can lift the row (the pre-C20
  // C3 recipe loses the same race on the current build). While a row gesture
  // is armed (180ms stationary — a real scroll never pauses first), the screen
  // freezes list scrolling. The hook releases the lock with the JS touch
  // stream — and R2-01: handleDragEnd below releases it out-of-band when the
  // native drag layer took the stream (no press_out will ever arrive).
  const [gestureLock, setGestureLock] = useState(false);
  // R4-09: the band also lives in a ref because `handleRefresh` must read it
  // WITHOUT re-subscribing — its identity is the RefreshControl's `onRefresh` prop,
  // and churning that prop on every arm/release is exactly the shape change the
  // official wrapper keys its child tree on (B4-REGRESS F10).
  const handleGestureLockChange = useCallback((locked: boolean) => {
    gestureLiveRef.current = locked;
    setGestureLock(locked);
  }, []);

  // B4-SWIPE (批次四 F5 裁定 10): 列表区横滑切 进行中↔已归档。状态源仍是上面的
  // `filter`——手势落地只调用同一个 `setFilter`（点 segment 也是它），绝不另立一份
  // 页状态；门是 `gestureLock`（行手势 arm→menu→drag 独占带）：拖拽期间禁切页。
  // 位移/门都走 Reanimated 共享值，DraggableList 的 props 一个都不翻转
  // （B4-REGRESS 重挂面纪律：翻转列表 props 的状态带=整表重挂）。
  const handleSwipePage = useCallback((page: FilterSwipePage) => {
    setFilter(page === FILTER_SWIPE_PAGE_ARCHIVED ? "archived" : "active");
  }, []);
  const swipe = useChatsFilterSwipe({
    page: filterSwipePageForArchived(archivedOnly),
    blocked: gestureLock,
    onSwitchPage: handleSwipePage,
  });

  // KI-11 ruling ④: the library hands back the whole list reordered; what the
  // drop MEANS is decided on the zone boundary by `decidePinDrop` and run by
  // `dispatchPinDrop` through the SAME action-layer calls the menu buttons
  // make — 拖入置顶 = actions.pin(target, slot), 拖出置顶 = actions.unpin(target),
  // 组内换位 = actions.reorderPinned, 非置顶区内移动 = nothing (the time-derived
  // order re-asserts itself). Headers carry no zone opinion and are dropped.
  const handleDragEnd = useCallback(
    (nextItems: ChatListItem<ShellChatAgent>[]) => {
      // R2-01: release the scroll lock FIRST — above the search-mode early
      // return, so no branch can strand the list unlocked-but-scroll-off. The
      // handoff is consume-once, so a re-fired drop or a drag-inert end is inert.
      dragLockHandoff.release();
      // C9: while a query narrows the list, handleDragEnd only sees the visible
      // subset — persisting it would drop the hidden pins. Drag is also disabled
      // in renderItem, so this is the belt to that braces.
      if (normalizedQuery.length > 0) return;
      const droppedKey = draggedKeyRef.current;
      draggedKeyRef.current = null;
      const visibleRowKeys: string[] = [];
      const targetByKey = new Map<string, ShellChatTarget>();
      for (const item of nextItems) {
        if (item.type !== "row") continue;
        const key = item.row.agent.key;
        visibleRowKeys.push(key);
        targetByKey.set(key, {
          key,
          serverId: item.row.agent.serverId,
          agentId: item.row.agent.agent.id,
        });
      }
      dispatchPinDrop(decidePinDrop({ droppedKey, visibleRowKeys, pinnedIds }), {
        actions,
        targetOf: (key) => targetByKey.get(key) ?? null,
      });
    },
    [actions, dragLockHandoff, pinnedIds, normalizedQuery],
  );

  // KI-11 ruling ③ + B4-REGRESS F10 + B5-F15: the gesture band's list props, all
  // five from one pure function (drag-drop.ts) — the control stays MOUNTED and
  // goes natively DISABLED (`refreshControlEnabled=false`) for the band,
  // `refreshing` is forced false, `scrollEnabled` freezes, and `containerStyle`
  // is the same flex:1 object in both states. The 顶部向下拖 pull can no longer
  // even start while the band lives; a callback that still lands (iOS, or a pull
  // that beat the disable commit) is swallowed in `handleRefresh` (R4-09).
  const gestureBand = chatGestureBandProps({
    gestureLive: gestureLock,
    refreshing,
    onRefresh: handleRefresh,
  });

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

  // B4-BACK (F9/裁定 15): Android back exits the search first — 清查询+收起 via
  // the same handleSearchClose the 取消 button rides — and the 对话 tab only
  // claims the press while it IS the frontmost route (a pushed detail or the
  // other tab keeps its own back; shell-back-priority.ts owns that check).
  useShellSearchBackPriority(searchActive, handleSearchClose, {
    name: SHELL_TAB.chats,
  });
  const handleImportChat = useCallback(() => router.push(DETAIL.import as Href), []);
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
          onGestureLockChange={handleGestureLockChange}
          isActive={isActive}
          selected={
            item.row.agent.key === selectedAgentKey || item.row.agent.key === jump.highlightKey
          }
        />
      );
    },
    [
      actions,
      archivedOnly,
      searchActive,
      handleOpenChat,
      handleRowDragStart,
      handleGestureLockChange,
      hostsById,
      handleRetryHost,
      selectedAgentKey,
      jump.highlightKey,
      t,
    ],
  );

  // 虚拟化 cell 的外部行状态：路由派生选中态（C31）+ 跳转一次性高亮（R4-17）。
  // 两者必须折进 extraData，否则行重渲判定看不到高亮翻转。memo 保引用稳定——
  // 每次 render 新对象=每次父级 render 全 cell 重渲（react-perf 纪律）。
  const listExtraData = useMemo(
    () => ({ selectedAgentKey, highlightKey: jump.highlightKey }),
    [selectedAgentKey, jump.highlightKey],
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
      {/* KI-12: ChatsHeader 自带 ShellTabHeader（inset 在容器内加一次），头栏是列表的
          兄弟节点——固定不随滚动，宽屏列表列复用同一 body 天然同构。 */}
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
      {showSkeleton ? (
        <View style={styles.skeletonWrap} testID="shell-chats-skeleton">
          <SidebarAgentListSkeleton />
        </View>
      ) : (
        // B4-SWIPE: 换页面板=列表的父容器。手势挂在这层（列表的祖先，和官方 explorer
        // 开合手势、壳 edge-back 同一拓扑），位移只动这层——列表自身、它的 props、
        // key、RefreshControl 全都不动。overflow:hidden 让「滑到墙外」真被裁掉
        // （iOS 默认溢出可见）；flex:1 保住列表尺寸。
        <GestureDetector gesture={swipe.gesture}>
          <Animated.View
            collapsable={false}
            style={[styles.swipeSurface, swipe.surfaceStyle]}
            onLayout={swipe.onSurfaceLayout}
          >
            <DraggableList
              key={`${listNonce}:${jump.nonce}`}
              data={items}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              onDragEnd={handleDragEnd}
              scrollEnabled={gestureBand.scrollEnabled}
              containerStyle={gestureBand.containerStyle}
              contentContainerStyle={styles.listContent}
              refreshing={gestureBand.refreshing}
              onRefresh={gestureBand.onRefresh}
              refreshControlEnabled={gestureBand.refreshEnabled}
              ListEmptyComponent={listEmpty}
              extraData={listExtraData}
              onDragTerminate={handleDragTerminate}
              testID="shell-chats-list"
            />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  skeletonWrap: {
    flex: 1,
    paddingHorizontal: theme.spacing[2],
  },
  // B4-SWIPE: 换页面板。flex:1 = 列表尺寸不变（容器塌陷=重挂面，见
  // `CHATS_LIST_CONTAINER_STYLE`）；overflow:hidden = 出场拍滑到墙外的部分真被裁掉，
  // 两页边界不露半个列表。
  swipeSurface: {
    flex: 1,
    overflow: "hidden",
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
