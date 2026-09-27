// L3 session 行 (DESIGN §14.8, card C26): provider 图标 + 会话标题 + 状态灯.
// 行体 = C4 opener (markRead 双拍 + 官方 navigateToAgent) — the screen owns it and
// passes the callback; 长按 = C3 五动作菜单, reused verbatim (ChatRowMenuContent +
// useShellAgentActions — 动作层本体不在本卡重抄). Geometry follows the 对话 row (§9);
// the row is deliberately leaner than ChatListRow: no subtitle (项目/worktree 已由
// 祖先行表达), no ⋯ button (置顶只在对话 tab，长按即达).
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { getProviderIcon } from "@/components/provider-icons";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { ChatRowMenuContent } from "@/shell/components/chat-row-menu";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import { shellRenameHref } from "@/shell/routes";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";
import type { WorkspaceTreeSession } from "@/shell/workspace/derive";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

function selectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

export function WorkspaceSessionRow({
  session,
  dimmed,
  actions,
  onOpen,
}: {
  session: WorkspaceTreeSession<AggregatedAgent>;
  /** Offline-host sections grey their cached rows. */
  dimmed: boolean;
  actions: ShellAgentActions;
  /** Screen-side C4 opener: read stamp + official navigateToAgent (open intent). */
  onOpen: (session: WorkspaceTreeSession<AggregatedAgent>) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const { agent } = session;

  const alias = usePaseoGoPinsStore((state) => state.aliases[session.key]);
  const pinned = usePaseoGoPinsStore((state) => state.pinnedIds.includes(session.key));
  const archived = usePaseoGoArchiveStore((state) => state.archivedIds.includes(session.key));
  const bucket = deriveSidebarStateBucket({
    status: agent.status,
    requiresAttention: Boolean(agent.requiresAttention),
    attentionReason: agent.attentionReason ?? null,
    pendingPermissionCount: agent.pendingPermissionCount ?? 0,
  });
  const stoppable = bucket === "running" || bucket === "needs_input";
  const imported = isImportedProviderSession(agent);
  const menuState = useMemo(
    () => ({ pinned, archived, stoppable, imported }),
    [pinned, archived, stoppable, imported],
  );

  const handlePress = useCallback(() => onOpen(session), [onOpen, session]);
  const target = useMemo<ShellChatTarget>(
    () => ({ key: session.key, serverId: agent.serverId, agentId: agent.id }),
    [session.key, agent.serverId, agent.id],
  );
  const displayTitle = alias ?? agent.title ?? t("chats.untitled");
  // C33: 重命名 pushes the rename screen through the menu's injected opener.
  const openRename = useCallback(
    (renameTarget: ShellChatTarget) => router.push(shellRenameHref(renameTarget)),
    [],
  );

  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.body, pressed && styles.rowPressed],
    [],
  );
  // C12 无障碍: 状态灯/置灰是纯视觉信息 — announce it.
  const labelParts = [displayTitle];
  if (dimmed) labelParts.push(t("chats.hostStatus.offline"));

  const ProviderIcon = getProviderIcon(agent.provider, agent.serverId);
  return (
    <ContextMenu compactMode="popover">
      <View
        style={[styles.shell, dimmed && styles.shellDimmed]}
        testID={`shell-workspace-session-shell-${session.key}`}
      >
        <ContextMenuTrigger
          testID={`shell-workspace-session-${session.key}`}
          accessibilityRole="button"
          accessibilityLabel={labelParts.join(" · ")}
          onPress={handlePress}
          onLongPress={selectionHaptic}
          style={triggerStyle}
        >
          <View style={styles.iconSlot}>
            <ProviderIcon size={17} color={styles.providerIcon.color} />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {displayTitle}
            </Text>
          </View>
          <ChatStatusLight agent={agent} bucket={bucket} />
        </ContextMenuTrigger>
      </View>
      <ChatRowMenuContent
        target={target}
        state={menuState}
        actions={actions}
        displayTitle={displayTitle}
        openRename={openRename}
      />
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  shell: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface0,
  },
  shellDimmed: {
    opacity: 0.55,
  },
  // 缩进两级：L1 标题列 ≈ 16+18+26, L2 再进一层, L3 最深。
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[4] + 18 + 22 + 22,
    paddingRight: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  iconSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  providerIcon: {
    color: theme.colors.foregroundMuted,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
}));
