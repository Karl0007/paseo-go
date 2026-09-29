// Chat list row (DESIGN §4): provider icon | title (bold when unread; C18 badge:
// dot only on idle rows, count pill only while approvals pend) | shell alias when
// renamed | subtitle `project · relative time · last activity` |
// four-state light | ⋯ overflow. Geometry follows the official agent list (§9); the
// clock state is confined to the subtitle component so a minute tick never re-renders
// the row. Tapping calls the screen's opener (C4: official navigateToAgent — workspace
// route + open intent — plus the read stamp; never the parse-stub push).
//
// C3 interaction layer (card C3): every row wraps the official ContextMenu engine —
// long press opens the menu, the ⋯ button opens the same menu for accessibility.
// C19/C33 (DESIGN §14.3): the menu is the anchored popover — 重命名 left it for the
// (detail)/rename screen (KI-9 root stack), so the engine's "input pages stay
// sheets" rule no longer applies here.
// C20 (DESIGN §14.4): on the live filter EVERY row rides the DraggableFlatList
// through this arbitration hook — long-press decides the anchored window, and
// sliding past the relay slop dismisses it and lifts the row in ONE touch
// stream. Unpinned rows dropped into the group pin themselves at the drop slot
// (the screen owns that semantics). Rows fade in/out individually — keys are
// stable, so nothing ever re-mounts the whole table.
// KI-11 (rulings ①+②): the window OPENS at the menu threshold (250ms since the
// KI-16 halving) with the finger still down, and the relay fires from that
// VISIBLE menu. Both are only possible because the row menu's surface is no
// longer the engine's Modal —
// every chat-row menu (long press, ⋯, archived/search rows) renders through the
// shell-hosted `ShellRowMenuHost` (chat-row-menu.tsx). The engine's
// ContextMenu/ContextMenuTrigger stay as the press primitive + context provider
// only: no ChatRowMenuContent is mounted here anymore, so the engine's Modal
// never materialises for chat rows.
import { memo, useCallback, useMemo, useRef } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  useShellRowDragMenu,
  type RowMenuController,
} from "@/shell/components/use-shell-row-drag-menu";
import { CONTEXT_MENU_DELAY_MS } from "@/shell/components/drag-menu-arbitration";
import { getProviderIcon } from "@/components/provider-icons";
import { joinSubtitleParts } from "@/command-center/results";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { showsUnreadDot, type ChatRow } from "@/shell/chats/derive";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellRenameHref } from "@/shell/routes";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import { useShellRowMenuStore } from "@/shell/components/chat-row-menu";
import type { Rect } from "@/components/ui/menu";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";
import { resolveProjectPlacement } from "@/utils/project-placement";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";

/** The derivation input widened with the live agent payload the row renders. */
export interface ShellChatAgent {
  key: string;
  serverId: string;
  lastActivityAt: number;
  attentionTimestamp: number | null;
  bucket: SidebarStateBucket;
  agent: AggregatedAgent;
}

/** Row subtitle AND the C9 search haystack read the same 最后动态 label map. */
export const ACTIVITY_LABEL_KEY: Record<SidebarStateBucket, string | null> = {
  needs_input: "chats.activity.needsInput",
  failed: "chats.activity.failed",
  running: "chats.activity.running",
  attention: "chats.activity.finished",
  done: null,
};

const NOOP = (): void => {};

function selectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

// C18 双点收敛 — two independent judgements in the badge slot: the count pill is a
// state marker (approvals pend) and renders on count>0 alone — permission requests
// carry no attention stamp, so gating it on `unread` would make it vanish; the dot
// is the unread mark and only ever shows on idle rows (showsUnreadDot) — active
// buckets wear their state on the status light + bold title, never a second dot.
function ChatBadge({
  bucket,
  count,
  unread,
  rowKey,
}: {
  bucket: SidebarStateBucket;
  count: number;
  unread: boolean;
  rowKey: string;
}) {
  if (count > 0) {
    return (
      <View style={styles.countBadge}>
        <Text style={styles.countBadgeText}>{count}</Text>
      </View>
    );
  }
  if (unread && showsUnreadDot(bucket, count)) {
    return <View style={styles.unreadDot} testID={`shell-chat-unread-${rowKey}`} />;
  }
  return null;
}

const ChatSubtitle = memo(function ChatSubtitle({
  agent,
  bucket,
}: {
  agent: AggregatedAgent;
  bucket: SidebarStateBucket;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const timeAgo = useCompactTimeAgo(agent.lastActivityAt);
  const project = resolveProjectPlacement({
    projectPlacement: agent.projectPlacement,
    cwd: agent.cwd,
  }).projectName;
  const activityKey = ACTIVITY_LABEL_KEY[bucket];
  return (
    <Text style={styles.subtitle} numberOfLines={1}>
      {joinSubtitleParts([project, timeAgo, activityKey ? t(activityKey) : null])}
    </Text>
  );
});

interface ChatListRowProps {
  row: ChatRow<ShellChatAgent>;
  actions: ShellAgentActions;
  /** Screen-side C4 opener: read stamp + official navigateToAgent (open intent). */
  onOpen: (agent: ShellChatAgent) => void;
  /** True on the live filter (C20): long-press runs the arbitration hook —
   * menu window, and menu→drag relay onto any drop slot. */
  draggable?: boolean;
  /** DraggableFlatList's activator for this cell; only used when draggable. */
  drag?: () => void;
  /** C20: fires in the same frame as drag() with the row's key; the screen
   * records it there so its drop handler knows what moved. R2-01: the second
   * argument is this touch's out-of-band scroll-lock release — the drop
   * handler must run it, because after the native takeover no press_out will. */
  onDragStart?: (key: string, releaseGestureLock: () => void) => void;
  /** C20: row gesture armed/released — the screen freezes list scrolling
   * while a drag-vs-menu decision is live (native ScrollView steal guard). */
  onGestureLockChange?: (locked: boolean) => void;
  /** DraggableFlatList reports the lifted cell; drives the raised style. */
  isActive?: boolean;
  /** C31 平板选中态 (DESIGN-tablet §3.2): the detail column renders THIS row's
   * session — route-derived by the split list column, never a local selection.
   * Compact callers pass nothing (no selection concept there, §4-1). */
  selected?: boolean;
}

export const ChatListRow = memo(function ChatListRow({
  row,
  actions,
  onOpen,
  draggable = false,
  drag,
  onDragStart,
  onGestureLockChange,
  isActive = false,
  selected = false,
}: ChatListRowProps) {
  return (
    <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)}>
      <ContextMenu compactMode="popover">
        <ChatRowInner
          row={row}
          actions={actions}
          onOpen={onOpen}
          draggable={draggable}
          drag={drag ?? NOOP}
          onDragStart={onDragStart}
          onGestureLockChange={onGestureLockChange}
          isActive={isActive}
          selected={selected}
        />
      </ContextMenu>
    </Animated.View>
  );
});
// Lives under the ContextMenu provider because ContextMenuTrigger reads its
// context — the provider is all the engine is used for on chat rows now
// (KI-11): the menu itself renders through the shell-hosted `ShellRowMenuHost`.
function ChatRowInner({
  row,
  actions,
  onOpen,
  draggable,
  drag,
  onDragStart,
  onGestureLockChange,
  isActive,
  selected,
}: {
  row: ChatRow<ShellChatAgent>;
  actions: ShellAgentActions;
  onOpen: (agent: ShellChatAgent) => void;
  draggable: boolean;
  drag: () => void;
  onDragStart?: (key: string, releaseGestureLock: () => void) => void;
  onGestureLockChange?: (locked: boolean) => void;
  isActive: boolean;
  selected: boolean;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const { agent, unread, dimmed } = row;

  const alias = usePaseoGoPinsStore((state) => state.aliases[agent.key]);
  const pinned = usePaseoGoPinsStore((state) => state.pinnedIds.includes(agent.key));
  const archived = usePaseoGoArchiveStore((state) => state.archivedIds.includes(agent.key));

  // Stable per row: the screen's recorder stays referentially stable while the
  // key is captured here (DraggableFlatList keeps cell props identity-tight).
  const handleDragStart = useCallback(
    (releaseGestureLock: () => void) => {
      onDragStart?.(agent.key, releaseGestureLock);
    },
    [agent.key, onDragStart],
  );

  const target = useMemo<ShellChatTarget>(
    () => ({ key: agent.key, serverId: agent.serverId, agentId: agent.agent.id }),
    [agent.key, agent.serverId, agent.agent.id],
  );
  const displayTitle = alias ?? agent.agent.title ?? t("chats.untitled");
  // 停止 only acts on an abortable turn: running, or blocked on an approval.
  const stoppable = agent.bucket === "running" || agent.bucket === "needs_input";
  const imported = isImportedProviderSession(agent.agent);
  const menuState = useMemo(
    () => ({ pinned, archived, stoppable, imported }),
    [pinned, archived, stoppable, imported],
  );
  // C33: 重命名 pushes the (detail) rename screen (KI-9; object params, hostile ids).
  const openRename = useCallback(
    (renameTarget: ShellChatTarget) => router.push(shellRenameHref(renameTarget)),
    [],
  );

  // KI-11: every open path lands on the shell-hosted single-instance menu.
  // The payload is the snapshot the host renders; the controller is the
  // hook's actuator (open at the threshold, close only this row's request).
  const menuPayload = useMemo(
    () => ({ target, state: menuState, actions, displayTitle, openRename }),
    [target, menuState, actions, displayTitle, openRename],
  );
  const openMenuAt = useCallback(
    (anchor: Rect) => {
      useShellRowMenuStore.getState().open({ ...menuPayload, anchor });
    },
    [menuPayload],
  );
  const menuController = useMemo<RowMenuController>(
    () => ({
      openMenu: (point) => openMenuAt({ x: point.x, y: point.y, width: 0, height: 0 }),
      closeMenu: () => useShellRowMenuStore.getState().closeFor(agent.key),
    }),
    [openMenuAt, agent.key],
  );
  const interaction = useShellRowDragMenu({
    drag,
    menuController,
    onDragStart: handleDragStart,
    onGestureLockChange,
  });

  const handlePress = useCallback(() => {
    // A finished long press (menu or drag) swallows the press that follows it —
    // the official sidebar idiom for rows that both navigate and arm gestures.
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onOpen(agent);
  }, [agent, interaction.didLongPressRef, onOpen]);

  // C12 无障碍: the ⋯ opens the same host menu, anchored on the button's own
  // rect (measureInWindow reads in the same space the host positions in).
  const moreRef = useRef<View>(null);
  const handleMore = useCallback(() => {
    moreRef.current?.measureInWindow((x, y, width, height) => {
      openMenuAt({ x, y, width, height });
    });
  }, [openMenuAt]);

  // Archived/search rows keep the plain Pressable long press (no drag layer,
  // so no arbitration): the trigger's own CONTEXT_MENU_DELAY_MS tick opens the
  // host menu at the touch point — KI-16 passes the threshold explicitly below
  // (no reliance on React Native's internal 500ms default; single source).
  const handleLongPress = useCallback(
    (event: GestureResponderEvent) => {
      selectionHaptic();
      const { pageX, pageY } = event.nativeEvent;
      if (typeof pageX === "number" && typeof pageY === "number") {
        openMenuAt({ x: pageX, y: pageY, width: 0, height: 0 });
      }
    },
    [openMenuAt],
  );
  // Web right-click (the engine trigger forwards it; native never fires it).
  const handleContextMenu = useCallback(
    (event: unknown) => {
      const source = event as {
        nativeEvent?: { pageX?: number; pageY?: number };
        pageX?: number;
        pageY?: number;
      } | null;
      const point = source?.nativeEvent ?? source;
      const x = point?.pageX;
      const y = point?.pageY;
      if (typeof x === "number" && typeof y === "number") {
        openMenuAt({ x, y, width: 0, height: 0 });
      }
    },
    [openMenuAt],
  );

  const activityLabelKey = ACTIVITY_LABEL_KEY[agent.bucket];
  const rowLabel = [
    displayTitle,
    unread ? t("chats.a11yUnread") : null,
    activityLabelKey ? t(activityLabelKey) : null,
    dimmed ? t("chats.hostStatus.offline") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  const ProviderIcon = getProviderIcon(agent.agent.provider, agent.agent.serverId);
  const pendingCount = agent.agent.pendingPermissionCount ?? 0;

  return (
    <View
      style={[
        styles.rowShell,
        selected && styles.rowSelected,
        isActive && styles.rowDragging,
        dimmed && styles.rowDimmed,
      ]}
      testID={`shell-chat-row-shell-${agent.key}`}
    >
      <ContextMenuTrigger
        testID={`shell-chat-row-${agent.key}`}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        onPress={handlePress}
        // KI-11: the engine's native Modal-open path is retired for chat rows
        // (enabledOnMobile=false keeps the trigger as a press primitive only).
        // Draggable rows (every live-filter row since C20) hand the long press
        // to the arbitration hook, which opens the host menu at its own tick;
        // archived/search rows open the same host menu from the Pressable long
        // press below. KI-16: BOTH ride the same CONTEXT_MENU_DELAY_MS — the
        // trigger's delay is passed explicitly, killing the "coincidence 500".
        enabledOnMobile={false}
        longPressDelayMs={CONTEXT_MENU_DELAY_MS}
        onLongPress={draggable ? undefined : handleLongPress}
        onContextMenu={handleContextMenu}
        onPressIn={draggable ? interaction.handlePressIn : undefined}
        onTouchMove={draggable ? interaction.handleTouchMove : undefined}
        onPressOut={draggable ? interaction.handlePressOut : undefined}
        style={triggerStyle}
      >
        <View style={styles.iconSlot}>
          <ProviderIcon size={18} color={styles.providerIcon.color} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
              {displayTitle}
            </Text>
            <ChatBadge
              bucket={agent.bucket}
              count={pendingCount}
              unread={unread}
              rowKey={agent.key}
            />
          </View>
          <ChatSubtitle agent={agent.agent} bucket={agent.bucket} />
        </View>
        <ChatStatusLight agent={agent.agent} bucket={agent.bucket} />
      </ContextMenuTrigger>
      <Pressable
        ref={moreRef}
        onPress={handleMore}
        accessibilityRole="button"
        accessibilityLabel={t("chats.menu.more")}
        hitSlop={8}
        testID={`shell-chat-more-${agent.key}`}
        style={styles.moreButton}
      >
        <MoreHorizontal size={16} color={styles.moreIcon.color} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowShell: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface0,
  },
  // C31: the wide list's route-derived selection — the official sidebar's own
  // selection surface, distinct from hover/press (surface1).
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  // Raised look for the lifted cell: DraggableFlatList moves the row, the shell
  // gives it the surface1 fill and the shadow that reads as elevation.
  rowDragging: {
    backgroundColor: theme.colors.surface1,
    elevation: 8,
  },
  rowDimmed: {
    opacity: 0.45,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  moreButton: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    alignItems: "center",
    justifyContent: "center",
  },
  moreIcon: {
    color: theme.colors.foregroundExtraMuted,
  },
  iconSlot: {
    width: 28,
    alignItems: "center",
  },
  // Static color holder for the dynamic provider icon (the schedule-row glyph idiom).
  providerIcon: {
    color: theme.colors.foregroundMuted,
  },
  body: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  titleUnread: {
    fontWeight: theme.fontWeight.bold,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[1.5],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.statusDotWarning,
  },
  countBadgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
