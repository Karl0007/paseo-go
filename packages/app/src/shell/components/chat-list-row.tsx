// Chat list row (DESIGN §4): provider icon | title (bold + badge when unread) |
// subtitle `project · relative time · last activity` | four-state light. Geometry
// follows the official agent list (§9); the clock state is confined to the subtitle
// component so a minute tick never re-renders the row. Tapping pushes the official
// agent route (temporary direct push; C4 rewires it to the workspace route).
import { memo, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { getProviderIcon } from "@/components/provider-icons";
import { joinSubtitleParts } from "@/command-center/results";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { ChatRow } from "@/shell/chats/derive";
import { OFFICIAL } from "@/shell/routes";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
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

export const ChatListRow = memo(function ChatListRow({ row }: { row: ChatRow<ShellChatAgent> }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const { agent, unread, dimmed } = row;
  const handlePress = useCallback(() => {
    router.push(OFFICIAL.agent(agent.serverId, agent.agent.id) as Href);
  }, [agent.serverId, agent.agent.id]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      pressed && styles.rowPressed,
      dimmed && styles.rowDimmed,
    ],
    [dimmed],
  );
  const ProviderIcon = getProviderIcon(agent.agent.provider, agent.agent.serverId);
  const pendingCount = agent.agent.pendingPermissionCount ?? 0;
  return (
    <Pressable
      testID={`shell-chat-row-${agent.key}`}
      onPress={handlePress}
      accessibilityRole="button"
      style={rowStyle}
    >
      <View style={styles.iconSlot}>
        <ProviderIcon size={18} color={styles.providerIcon.color} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {agent.agent.title ?? t("chats.untitled")}
          </Text>
          {unread ? <UnreadBadge count={pendingCount} rowKey={agent.key} /> : null}
        </View>
        <ChatSubtitle agent={agent.agent} bucket={agent.bucket} />
      </View>
      <ChatStatusLight agent={agent.agent} bucket={agent.bucket} />
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  rowDimmed: {
    opacity: 0.45,
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
