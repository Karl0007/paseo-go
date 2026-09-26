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
// (shell)/rename screen, so the engine's "input pages stay sheets" rule no longer
// applies here.
// C20 (DESIGN §14.4): on the live filter EVERY row rides the DraggableFlatList
// through this arbitration hook — long-press decides the anchored window (shown
// on release), and sliding past the relay slop dismisses it and lifts the row in
// touch stream (menu→drag relay). Unpinned rows dropped into the group pin
// themselves at the drop slot (the screen owns that semantics). Rows fade
// in/out individually — keys are stable, so nothing ever re-mounts the whole
// table.
import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ContextMenu, ContextMenuTrigger, useContextMenu } from "@/components/ui/context-menu";
import { useShellRowDragMenu } from "@/shell/components/use-shell-row-drag-menu";
import { getProviderIcon } from "@/components/provider-icons";
import { joinSubtitleParts } from "@/command-center/results";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { showsUnreadDot, type ChatRow } from "@/shell/chats/derive";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellRenameHref } from "@/shell/routes";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import { ChatRowMenuContent } from "@/shell/components/chat-row-menu";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";
import { resolveProjectPlacement } from "@/utils/project-placement";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

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
   * records it there so its drop handler knows what moved. */
  onDragStart?: (key: string) => void;
  /** C20: row gesture armed/released — the screen freezes list scrolling
   * while a drag-vs-menu decision is live (native ScrollView steal guard). */
  onGestureLockChange?: (locked: boolean) => void;
  /** DraggableFlatList reports the lifted cell; drives the raised style. */
  isActive?: boolean;
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
        />
      </ContextMenu>
    </Animated.View>
  );
});

// Lives under the ContextMenu provider so it can hold the menu controller: draggable
// rows (every row on the live filter, C20) open the window through the arbitration
// hook (which anchors at the touch point), the rest through the trigger's own long press.
function ChatRowInner({
  row,
  actions,
  onOpen,
  draggable,
  drag,
  onDragStart,
  onGestureLockChange,
  isActive,
}: {
  row: ChatRow<ShellChatAgent>;
  actions: ShellAgentActions;
  onOpen: (agent: ShellChatAgent) => void;
  draggable: boolean;
  drag: () => void;
  onDragStart?: (key: string) => void;
  onGestureLockChange?: (locked: boolean) => void;
  isActive: boolean;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const menu = useContextMenu();
  const { agent, unread, dimmed } = row;

  const alias = usePaseoGoPinsStore((state) => state.aliases[agent.key]);
  const pinned = usePaseoGoPinsStore((state) => state.pinnedIds.includes(agent.key));
  const archived = usePaseoGoArchiveStore((state) => state.archivedIds.includes(agent.key));

  // Stable per row: the screen's recorder stays referentially stable while the
  // key is captured here (DraggableFlatList keeps cell props identity-tight).
  const handleDragStart = useCallback(() => {
    onDragStart?.(agent.key);
  }, [agent.key, onDragStart]);
  const interaction = useShellRowDragMenu({
    drag,
    menuController: menu,
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
  const handleMore = useCallback(() => menu.setOpen(true), [menu]);

  const target = useMemo<ShellChatTarget>(
    () => ({ key: agent.key, serverId: agent.serverId, agentId: agent.agent.id }),
    [agent.key, agent.serverId, agent.agent.id],
  );
  const displayTitle = alias ?? agent.agent.title ?? t("chats.untitled");
  // C12 无障碍: rows carry purely-visual info (未读角标/状态灯/置灰) — announce it.
  const activityLabelKey = ACTIVITY_LABEL_KEY[agent.bucket];
  const rowLabel = [
    displayTitle,
    unread ? t("chats.a11yUnread") : null,
    activityLabelKey ? t(activityLabelKey) : null,
    dimmed ? t("chats.hostStatus.offline") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // 停止 only acts on an abortable turn: running, or blocked on an approval.
  const stoppable = agent.bucket === "running" || agent.bucket === "needs_input";
  const menuState = useMemo(() => ({ pinned, archived, stoppable }), [pinned, archived, stoppable]);
  // C33: 重命名 pushes the hidden-tab rename screen (object params, hostile ids).
  const openRename = useCallback(
    (renameTarget: ShellChatTarget) => router.push(shellRenameHref(renameTarget)),
    [],
  );

  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  const ProviderIcon = getProviderIcon(agent.agent.provider, agent.agent.serverId);
  const pendingCount = agent.agent.pendingPermissionCount ?? 0;

  return (
    <>
      <View
        style={[styles.rowShell, isActive && styles.rowDragging, dimmed && styles.rowDimmed]}
        testID={`shell-chat-row-shell-${agent.key}`}
      >
        <ContextMenuTrigger
          testID={`shell-chat-row-${agent.key}`}
          accessibilityRole="button"
          accessibilityLabel={rowLabel}
          onPress={handlePress}
          // Draggable rows (every live-filter row since C20) hand long press to the
          // arbitration hook — the hook fires its own tick when the window opens, so
          // the engine's native mobile trigger stays disabled and onLongPress unset.
          // Archived/search-view rows keep the engine's own native long press.
          enabledOnMobile={!draggable}
          onLongPress={draggable ? undefined : selectionHaptic}
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
      <ChatRowMenuContent
        target={target}
        state={menuState}
        actions={actions}
        displayTitle={displayTitle}
        openRename={openRename}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowShell: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface0,
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
