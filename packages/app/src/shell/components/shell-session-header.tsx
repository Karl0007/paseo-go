// C14 shell session header (DESIGN §7, card C14): the thin bar the shell floats over
// the official session screen. C4 proved the official header has no injection point,
// and the on-device probe (evidence/C14) proved the official compact header is ALWAYS
// visible (shouldShowWorkspaceScreenHeader = !focusMode || isMobile) and 110dp tall —
// a ≤44dp top bar cannot cover it and stacking one above it is the double-header the
// card forbids. Per the card's coexistence branch the bar therefore lives at the
// BOTTOM: a compact floating capsule (h=44dp) clear of the composer's minimum
// footprint, holding 返回 | 标题(别名优先) | 状态灯 | ⋯(查看项目文件/停止/重命名).
//
// Mechanism (measured, see evidence/C14 + report): an RN <Modal> mounted under a
// covered native-stack screen never creates its window (react-native-screens detaches
// the covered view; ReactModalHostView defers showDialog until attached), and a plain
// <Portal> registers against BottomSheetModalProvider's nested root-less PortalProvider
// and renders nowhere. The official `content-floating-panels` host (FloatingPanelPortalHost,
// absoluteFill + box-none, rendered after the navigator in AppContainer) floats above
// every screen in-window: touches outside the capsule pass through to the session, and
// system back/gesture pop it untouched.
//
// Visibility lives in the pure module (session-header/visibility, unit-tested); the
// live agent comes from the official session store's focusedAgentId — the open intent
// is consumed-and-cleared from the URL and tab switches never touch it.
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router, usePathname, useRootNavigation } from "expo-router";
import { Portal } from "@gorhom/portal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, FolderTree, MoreHorizontal, PenLine, Square } from "lucide-react-native";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  useContextMenu,
} from "@/components/ui/context-menu";
import { MenuSubTrigger } from "@/components/ui/menu";
import { DEFAULT_FLOATING_PANEL_PORTAL_HOST } from "@/components/ui/floating-panel-portal";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellFilesDetailHref } from "@/shell/routes";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoShellActive } from "@/shell/stores/settings";
import { useShellAgentActions, type ShellChatTarget } from "@/shell/shellAgentActions";
import { ChatRenamePage } from "@/shell/components/chat-row-menu";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import {
  resolveShellSessionWorkspace,
  sessionHeaderMenuPlan,
  type SessionHeaderActionId,
  type ShellSessionWorkspaceTarget,
} from "@/shell/session-header/visibility";

/** Stable portal slot: one header capsule app-wide. */
const SESSION_HEADER_PORTAL_NAME = "paseoGo-session-header";
const RENAME_PAGE_ID = "sessionRename";

/** The composer dock's minimum footprint (input bubble + control chips row), dp.
 *  Measured on-device: 130dp total, of which insets.bottom ≈ 20dp — the fixed part
 *  is 110dp; +8dp keeps the capsule clear of the bubble's top edge. */
const COMPOSER_CLEARANCE_DP = 118;

const ThemedChevronLeft = withUnistyles(ChevronLeft, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedFolderTree = withUnistyles(FolderTree, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedSquare = withUnistyles(Square, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPenLine = withUnistyles(PenLine, (theme) => ({ color: theme.colors.foregroundMuted }));

function actionLeading(id: SessionHeaderActionId) {
  switch (id) {
    case "files":
      return <ThemedFolderTree size={16} />;
    case "stop":
      return <ThemedSquare size={16} />;
    case "rename":
      return <ThemedPenLine size={16} />;
  }
}

export function ShellSessionHeaderOverlay() {
  const shellActive = usePaseoGoShellActive();
  const pathname = usePathname();
  // Root-Stack provenance: the layout component is not a screen, so neither
  // useRootNavigationState (resolves to the router `__root` container) nor the
  // ambient useNavigation context is dependable here. The navigation CONTAINER's
  // state has one `__root` route whose nested state IS the app Stack — the array
  // carrying the `(shell)` / `h/[serverId]` entries. Render-time read is current:
  // every push/pop changes the pathname below, which re-renders this overlay.
  const rootState = useRootNavigation()?.getState()?.routes[0]?.state;

  const workspace = useMemo(
    () =>
      resolveShellSessionWorkspace({
        shellMode: shellActive,
        pathname,
        rootRoutes: (rootState?.routes ?? []).map((route) => route.name),
        rootIndex: rootState?.index ?? -1,
      }),
    [shellActive, pathname, rootState],
  );
  const serverId = workspace?.serverId ?? null;

  // The official session store's focus is the live agent identity: the workspace
  // screen writes it on every tab focus and clears it on blur/unmount.
  const focusedAgentId = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.focusedAgentId ?? null) : null,
  );

  const { agents } = useAggregatedAgents();
  const agent = useMemo(() => {
    if (!serverId || !focusedAgentId) return null;
    return (
      agents.find((entry) => entry.serverId === serverId && entry.id === focusedAgentId) ?? null
    );
  }, [agents, serverId, focusedAgentId]);

  if (!workspace || !agent) return null;
  return <ShellSessionHeaderCapsule workspace={workspace} agent={agent} />;
}

// The provider lives ABOVE the consumer (the ChatListRow/ChatRowInner split):
// `useContextMenu` reads a context the capsule itself renders.
function ShellSessionHeaderCapsule({
  workspace,
  agent,
}: {
  workspace: ShellSessionWorkspaceTarget;
  agent: AggregatedAgent;
}) {
  return (
    <Portal hostName={DEFAULT_FLOATING_PANEL_PORTAL_HOST} name={SESSION_HEADER_PORTAL_NAME}>
      <ContextMenu>
        <CapsuleInner workspace={workspace} agent={agent} />
      </ContextMenu>
    </Portal>
  );
}

function CapsuleInner({
  workspace,
  agent,
}: {
  workspace: ShellSessionWorkspaceTarget;
  agent: AggregatedAgent;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const menu = useContextMenu();
  const actions = useShellAgentActions();

  const key = `${workspace.serverId}:${agent.id}`;
  const alias = usePaseoGoPinsStore((state) => state.aliases[key]);
  const bucket = deriveSidebarStateBucket({
    status: agent.status,
    requiresAttention: Boolean(agent.requiresAttention),
    attentionReason: agent.attentionReason ?? null,
    pendingPermissionCount: agent.pendingPermissionCount ?? 0,
  });
  const stoppable = bucket === "running" || bucket === "needs_input";
  const displayTitle = alias ?? agent.title ?? t("chats.untitled");

  const target = useMemo<ShellChatTarget>(
    () => ({ key, serverId: workspace.serverId, agentId: agent.id }),
    [key, workspace.serverId, agent.id],
  );

  const capsuleStyle = useMemo(
    () => [styles.capsule, { bottom: insets.bottom + COMPOSER_CLEARANCE_DP }],
    [insets.bottom],
  );

  const goBack = useCallback(() => {
    // Same verb as the system back: pops the official screen onto the shell list
    // (C4's push-verb entry keeps that list mounted below).
    router.back();
  }, []);
  const openMenu = useCallback(() => menu.setOpen(true), [menu]);

  // 查看项目文件: the (detail) files instance (C16) — a real root-Stack push on
  // top of the session screen, so hardware/gesture back pops right back here.
  // The old shellFilesHref target ((shell) hidden-tab route) resolved into the
  // existing (shell) entry (navigate-reuse), popping the session — C14's
  // recorded defect. The jump stays exact (workspace ids round-trip through
  // the param-object builder).
  const run = useCallback(
    (id: SessionHeaderActionId) => {
      if (id === "files") {
        router.push(shellFilesDetailHref(workspace.serverId, workspace.workspaceId));
        return;
      }
      if (id === "stop") void actions.stop(target);
    },
    [actions, target, workspace.serverId, workspace.workspaceId],
  );
  const runFiles = useCallback(() => run("files"), [run]);
  const runStop = useCallback(() => run("stop"), [run]);

  // Stable style fn (the row-press pattern): an inline arrow would rebuild per render.
  const iconButtonStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.iconButton, pressed && styles.iconButtonPressed],
    [],
  );

  const pages = useMemo(
    () => [
      {
        id: RENAME_PAGE_ID,
        title: t("chats.menu.renameTitle"),
        hoverIntent: false,
        content: <ChatRenamePage target={target} alias={alias} actions={actions} />,
      },
    ],
    [actions, alias, t, target],
  );

  return (
    <>
      <View pointerEvents="box-none" style={styles.layer}>
        <View style={capsuleStyle} testID={`shell-session-header-${key}`}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t("header.back")}
            hitSlop={6}
            style={iconButtonStyle}
            testID={`shell-session-back-${key}`}
          >
            <ThemedChevronLeft size={20} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1} testID={`shell-session-title-${key}`}>
            {displayTitle}
          </Text>
          <ChatStatusLight agent={agent} bucket={bucket} />
          <Pressable
            onPress={openMenu}
            accessibilityRole="button"
            accessibilityLabel={t("header.menu")}
            hitSlop={6}
            style={iconButtonStyle}
            testID={`shell-session-menu-open-${key}`}
          >
            <ThemedMoreHorizontal size={18} />
          </Pressable>
        </View>
      </View>
      <ContextMenuContent
        sheetTitle={displayTitle}
        pages={pages}
        width={280}
        testID={`shell-session-menu-${key}`}
      >
        {sessionHeaderMenuPlan({ stoppable }).map((item) => {
          if (item.id === "rename") {
            return (
              <MenuSubTrigger
                key={item.id}
                id={RENAME_PAGE_ID}
                leading={actionLeading(item.id)}
                testID="shell-session-menu-rename"
              >
                {t("chats.menu.rename")}
              </MenuSubTrigger>
            );
          }
          const label = item.id === "files" ? t("header.menuFiles") : t("chats.menu.stop");
          const onSelect = item.id === "files" ? runFiles : runStop;
          return (
            <ContextMenuItem
              key={item.id}
              leading={actionLeading(item.id)}
              disabled={!item.enabled}
              onSelect={onSelect}
              testID={`shell-session-menu-${item.id}`}
            >
              {label}
            </ContextMenuItem>
          );
        })}
      </ContextMenuContent>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  capsule: {
    position: "absolute",
    left: theme.spacing[3],
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[1],
    borderRadius: 22,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    maxWidth: "72%",
    ...theme.shadow.md,
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    flexShrink: 0,
  },
  iconButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
}));
