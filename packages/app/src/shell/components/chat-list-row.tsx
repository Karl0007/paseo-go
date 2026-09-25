// Chat list row (DESIGN §4): provider icon | title (bold + badge when unread,
// shell alias when renamed) | subtitle `project · relative time · last activity` |
// four-state light | ⋯ overflow. Geometry follows the official agent list (§9); the
// clock state is confined to the subtitle component so a minute tick never re-renders
// the row. Tapping pushes the official agent route (temporary direct push; C4 rewires
// it to the workspace route).
//
// C3 interaction layer (card C3): every row wraps the official ContextMenu engine —
// long press opens the sheet menu, the ⋯ button opens the same menu for accessibility.
// Pinned rows additionally ride the DraggableFlatList: the shell's own arbitration
// hook splits 长按停留 (menu, 450ms stationary) from 长按拖动 (drag armed at 180ms,
// activated on movement), so drag and menu never fight. Rows fade in/out individually —
// keys are stable, so nothing ever re-mounts the whole table.
import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
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
import type { ChatRow } from "@/shell/chats/derive";
import { OFFICIAL } from "@/shell/routes";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
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

const ACTIVITY_LABEL_KEY: Record<SidebarStateBucket, string | null> = {
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

// WeChat-style unread mark: a count pill when the chat is waiting on approvals,
// otherwise a plain accent dot.
function UnreadBadge({ count, rowKey }: { count: number; rowKey: string }) {
  if (count > 0) {
    return (
      <View style={styles.countBadge}>
        <Text style={styles.countBadgeText}>{count}</Text>
      </View>
    );
  }
  return <View style={styles.unreadDot} testID={`shell-chat-unread-${rowKey}`} />;
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
  /** True for rows inside the 置顶 group on the live filter: long-press arms a drag. */
  draggable?: boolean;
  /** DraggableFlatList's activator for this cell; only used when draggable. */
  drag?: () => void;
  /** DraggableFlatList reports the lifted cell; drives the raised style. */
  isActive?: boolean;
}

export const ChatListRow = memo(function ChatListRow({
  row,
  actions,
  draggable = false,
  drag,
  isActive = false,
}: ChatListRowProps) {
  return (
    <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)}>
      <ContextMenu>
        <ChatRowInner
          row={row}
          actions={actions}
          draggable={draggable}
          drag={drag ?? NOOP}
          isActive={isActive}
        />
      </ContextMenu>
    </Animated.View>
  );
});

// Lives under the ContextMenu provider so it can hold the menu controller: draggable
// rows open the sheet through the arbitration hook (which anchors at the touch point),
// everything else through the trigger's own long press.
function ChatRowInner({
  row,
  actions,
  draggable,
  drag,
  isActive,
}: {
  row: ChatRow<ShellChatAgent>;
  actions: ShellAgentActions;
  draggable: boolean;
  drag: () => void;
  isActive: boolean;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const menu = useContextMenu();
  const { agent, unread, dimmed } = row;

  const alias = usePaseoGoPinsStore((state) => state.aliases[agent.key]);
  const pinned = usePaseoGoPinsStore((state) => state.pinnedIds.includes(agent.key));
  const archived = usePaseoGoArchiveStore((state) => state.archivedIds.includes(agent.key));

  const interaction = useShellRowDragMenu({ drag, menuController: menu });

  const handlePress = useCallback(() => {
    // A finished long press (menu or drag) swallows the press that follows it —
    // the official sidebar idiom for rows that both navigate and arm gestures.
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    router.push(OFFICIAL.agent(agent.serverId, agent.agent.id) as Href);
  }, [agent.serverId, agent.agent.id, interaction.didLongPressRef]);
  const handleMore = useCallback(() => menu.setOpen(true), [menu]);

  const target = useMemo<ShellChatTarget>(
    () => ({ key: agent.key, serverId: agent.serverId, agentId: agent.agent.id }),
    [agent.key, agent.serverId, agent.agent.id],
  );
  const displayTitle = alias ?? agent.agent.title ?? t("chats.untitled");
  // 停止 only acts on an abortable turn: running, or blocked on an approval.
  const stoppable = agent.bucket === "running" || agent.bucket === "needs_input";
  const menuState = useMemo(
    () => ({ pinned, archived, stoppable, alias }),
    [pinned, archived, stoppable, alias],
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
          onPress={handlePress}
          // Draggable rows hand long press to the arbitration hook; plain rows let
          // the engine's own native long press open the menu (with a selection tick).
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
              {unread ? <UnreadBadge count={pendingCount} rowKey={agent.key} /> : null}
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
