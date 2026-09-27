// C14 shell session header / C21 top replacement (DESIGN §14.5, card C21): the
// full-width bar the shell floats over the official session screen, replacing it.
// C14 proved the official compact header has no injection point and is ALWAYS
// visible (shouldShowWorkspaceScreenHeader = !focusMode || isMobile); the C14
// bottom-coexistence branch was overturned by the C21 ruling — the bar now sits
// at the very top, height = official compact header (inner 56 + top pad 8 on
// compact, inner 36 on wide) + status-bar inset, opaque surface0 with the same
// bottom-border token, so it paints the official header out and its controls
// (hamburger drawer, official ⋯, scripts button, explorer toggle) are
// unreachable BY DESIGN. The official ⋯'s useful half is aggregated into the
// capsule menu (see session-header/visibility for the matrix): 查看项目文件 /
// 查看 diff / 查看文件 / 运行脚本 / 停止 / 重命名 — the view rows ride the
// official openExplorerSidebarView path, the scripts page the official
// startWorkspaceScript/killTerminal RPCs.
//
// Edge gestures are re-routed for the capsule's whole visible span: the
// provider's symbol-keyed open-gesture blocker parks the official left-open
// (agent list) and right-open (explorer) swipes and releases them on unmount
// (shell-off / non-session routes see zero behaviour change), while a
// transparent 32dp left-edge band carries the shell's own rightward-swipe →
// router.back() (shell-header/edge-swipe + use-shell-edge-back-gesture). The band
// is compact-only (C32 裁定 2): wide pops via hardware back / the capsule 返回 key.
// While the compact explorer overlay is open the capsule yields its band
// (visibility input explorerOverlayOpen) — the overlay owns the top rail then.
//
// Mechanism (measured, see evidence/C14 + report): an RN <Modal> mounted under a
// covered native-stack screen never creates its window (react-native-screens
// detaches the covered view; ReactModalHostView defers showDialog until
// attached), and a plain <Portal> registers against BottomSheetModalProvider's
// nested root-less PortalProvider and renders nowhere. The official
// `content-floating-panels` host (FloatingPanelPortalHost, absoluteFill +
// box-none, rendered after the navigator in AppContainer) floats above every
// screen in-window: touches outside the bar pass through to the session, and
// system back/gesture pop it untouched.
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { router, usePathname, useRootNavigation } from "expo-router";
import { Portal } from "@gorhom/portal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronLeft,
  Files,
  FolderTree,
  GitCompare,
  MoreHorizontal,
  PenLine,
  Play,
  Square,
  RefreshCw,
} from "lucide-react-native";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  useContextMenu,
} from "@/components/ui/context-menu";
import { DEFAULT_FLOATING_PANEL_PORTAL_HOST } from "@/components/ui/floating-panel-portal";
import { MenuSubTrigger, type MenuPageDefinition } from "@/components/ui/menu";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { selectIsCompactFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { useBlockMobilePanelOpenGestures } from "@/mobile-panels/provider";
import {
  openExplorerSidebarView,
  type ExplorerSidebarView,
} from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellFilesDetailHref, shellRenameHref } from "@/shell/routes";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoShellActive } from "@/shell/stores/settings";
import { useShellAgentActions, type ShellChatTarget } from "@/shell/shellAgentActions";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import { useShellWindowCompact } from "@/shell/tablet/form-factor";
import {
  createSessionHeaderRunner,
  resolveShellSessionWorkspace,
  sessionHeaderMenuPlan,
  shouldEnableShellEdgeBack,
  type SessionHeaderActionableId,
  type SessionHeaderActionId,
  type ShellSessionWorkspaceTarget,
} from "@/shell/session-header/visibility";
import { SessionHeaderScriptsPage } from "@/shell/session-header/scripts-submenu";
import { SHELL_EDGE_BAND_WIDTH_DP } from "@/shell/session-header/edge-swipe";
import { useShellEdgeBackGesture } from "@/shell/session-header/use-shell-edge-back-gesture";

/** Stable portal slot: one header capsule app-wide. */
const SESSION_HEADER_PORTAL_NAME = "paseoGo-session-header";

const NO_SCRIPTS: never[] = [];

const ThemedChevronLeft = withUnistyles(ChevronLeft, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedFolderTree = withUnistyles(FolderTree, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedGitCompare = withUnistyles(GitCompare, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedFiles = withUnistyles(Files, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPlay = withUnistyles(Play, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedSquare = withUnistyles(Square, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPenLine = withUnistyles(PenLine, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedRefreshCw = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const HEADER_LABEL_KEY: Record<SessionHeaderActionId, string> = {
  files: "header.menuFiles",
  diff: "header.menuDiff",
  explorer: "header.menuExplorer",
  scripts: "header.menuScripts",
  stop: "chats.menu.stop",
  rename: "chats.menu.rename",
  refresh: "chats.menu.refresh",
};

function actionLeading(id: SessionHeaderActionId) {
  switch (id) {
    case "files":
      return <ThemedFolderTree size={16} />;
    case "diff":
      return <ThemedGitCompare size={16} />;
    case "explorer":
      return <ThemedFiles size={16} />;
    case "scripts":
      return <ThemedPlay size={16} />;
    case "stop":
      return <ThemedSquare size={16} />;
    case "rename":
      return <ThemedPenLine size={16} />;
    case "refresh":
      return <ThemedRefreshCw size={16} />;
  }
}

export function ShellSessionHeaderOverlay() {
  const shellActive = usePaseoGoShellActive();
  const pathname = usePathname();
  // C21: the compact explorer overlay paints its own top rail (tab dropdown +
  // close) exactly under the capsule band — while it is open the capsule yields
  // (visibility input). Wide layouts open the Explorer as a pane instead and
  // never flip mobilePanel.target, so this subscription is constant there.
  const explorerOverlayOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  // Root-Stack provenance: the layout component is not a screen, so neither
  // useRootNavigationState (resolves to the router `__root` container) nor the
  // ambient useNavigation context is dependable here. The navigation CONTAINER's
  // state has one `__root` route whose nested state IS the app Stack — the array
  // carrying the `(shell)` / `h/[serverId]` entries. Render-time read is current:
  // every push/pop changes the pathname below, which re-renders this overlay.
  const rootState = useRootNavigation()?.getState()?.routes[0]?.state;

  // C31-F1/C32: the compact flag comes from the window-dimension source the
  // tablet split uses — a runtime rotation flips the capsule's compact/wide
  // metrics together with the split (the Unistyles breakpoint stayed stale).
  const isCompact = useShellWindowCompact();

  const visibilityInput = useMemo(
    () => ({
      shellMode: shellActive,
      pathname,
      rootRoutes: (rootState?.routes ?? []).map((route) => route.name),
      rootIndex: rootState?.index ?? -1,
      explorerOverlayOpen,
      isCompact,
    }),
    [shellActive, pathname, rootState, explorerOverlayOpen, isCompact],
  );
  const workspace = useMemo(() => resolveShellSessionWorkspace(visibilityInput), [visibilityInput]);
  // C32 裁定 2: the left-edge back band is compact-only (wide pops via
  // hardware back / the capsule's 返回 key — an edge band would sit over the
  // split's list column).
  const edgeBackEnabled = useMemo(
    () => shouldEnableShellEdgeBack(visibilityInput),
    [visibilityInput],
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
  return (
    <ShellSessionHeaderCapsule
      workspace={workspace}
      agent={agent}
      isCompact={isCompact}
      edgeBackEnabled={edgeBackEnabled}
    />
  );
}

// The provider lives ABOVE the consumer (the ChatListRow/ChatRowInner split):
// `useContextMenu` reads a context the capsule itself renders.
function ShellSessionHeaderCapsule({
  workspace,
  agent,
  isCompact,
  edgeBackEnabled,
}: {
  workspace: ShellSessionWorkspaceTarget;
  agent: AggregatedAgent;
  isCompact: boolean;
  edgeBackEnabled: boolean;
}) {
  return (
    <Portal hostName={DEFAULT_FLOATING_PANEL_PORTAL_HOST} name={SESSION_HEADER_PORTAL_NAME}>
      <ContextMenu compactMode="popover">
        <CapsuleInner
          workspace={workspace}
          agent={agent}
          isCompact={isCompact}
          edgeBackEnabled={edgeBackEnabled}
        />
      </ContextMenu>
    </Portal>
  );
}

function CapsuleInner({
  workspace,
  agent,
  isCompact,
  edgeBackEnabled,
}: {
  workspace: ShellSessionWorkspaceTarget;
  agent: AggregatedAgent;
  isCompact: boolean;
  edgeBackEnabled: boolean;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const menu = useContextMenu();
  const actions = useShellAgentActions();
  const descriptor = useWorkspace(workspace.serverId, workspace.workspaceId);

  // C21 edge reroute, part 1: park the official left-open (agent list) and
  // right-open (explorer) gestures for exactly as long as the capsule exists.
  // The hook registers a fresh Symbol and releases it on unmount, so shell-off
  // and every non-session route see the official gestures untouched.
  useBlockMobilePanelOpenGestures(true);
  // C21 edge reroute, part 2: the shell's own left-edge right-swipe → back.
  // C32 裁定 2: enabled only while compact (the overlay's pure predicate decides).
  const edgeGesture = useShellEdgeBackGesture(edgeBackEnabled);

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

  // C21 menu inputs: the descriptor is the same live source the official header
  // cluster reads (scripts list, workspace directory, git placement).
  const scripts = descriptor?.scripts ?? NO_SCRIPTS;
  const hasCheckout = Boolean(descriptor?.workspaceDirectory);
  const isGit = descriptor?.project?.checkout?.isGit ?? true;
  // C24: the imported stamp (C22) is what gates the 刷新 row.
  const imported = isImportedProviderSession(agent);

  // The bar IS the header: top-anchored full width, official height + status
  // bar inset, opaque surface0 with the shared bottom-border token.
  const barStyle = useMemo(() => {
    const topPad = isCompact ? HEADER_TOP_PADDING_MOBILE : 0;
    const inner = isCompact ? HEADER_INNER_HEIGHT_MOBILE : HEADER_INNER_HEIGHT;
    return [styles.bar, { height: insets.top + topPad + inner, paddingTop: insets.top + topPad }];
  }, [insets.top, isCompact]);

  const goBack = useCallback(() => {
    // Same verb as the system back and the edge swipe: pops the official screen
    // onto the shell list (C4's push-verb entry keeps that list mounted below).
    router.back();
  }, []);
  const openMenu = useCallback(() => menu.setOpen(true), [menu]);

  // The dispatch table is the pure `createSessionHeaderRunner` (matrix test pins
  // it): 查看项目文件 is the (detail) files instance (C16) — a real root-Stack
  // push on top of the session screen, so hardware/gesture back pops right back
  // here. 重命名 (C33) pushes the (shell)/rename hidden tab: like the C14 finding
  // for SHELL.files, that resolves into the mounted (shell) entry
  // (navigate-reuse), so the capsule's rename chain lands on the rename screen
  // and returns to the 对话 list — the card's 回列表 semantics, not a
  // session-preserving push. 查看 diff / 查看文件 go through the ONE official
  // opener the keyboard action `workspace.tab.open` itself routes through
  // (workspace-screen handleWorkspacePanelOpenAction): on compact it sets the
  // explorer tab for the checkout and slides the overlay in; on wide it opens
  // the Explorer pane tab. Guard order mirrors the official call site.
  const openWorkspaceView = useCallback(
    (view: ExplorerSidebarView) => {
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
      });
      const cwd = descriptor?.workspaceDirectory ?? "";
      if (!workspaceKey || !cwd) return;
      openExplorerSidebarView({
        isCompact,
        workspaceKey,
        checkout: { serverId: workspace.serverId, cwd, isGit },
        view,
      });
    },
    [descriptor?.workspaceDirectory, isGit, isCompact, workspace.serverId, workspace.workspaceId],
  );
  const run = useMemo(
    () =>
      createSessionHeaderRunner({
        openFiles: () =>
          router.push(shellFilesDetailHref(workspace.serverId, workspace.workspaceId)),
        openDiff: () => openWorkspaceView("changes"),
        openExplorer: () => openWorkspaceView("files"),
        stop: () => void actions.stop(target),
        openRename: () => router.push(shellRenameHref(target)),
        refresh: () => void actions.refresh(target),
      }),
    [actions, openWorkspaceView, target, workspace.serverId, workspace.workspaceId],
  );
  const runFiles = useCallback(() => run("files"), [run]);
  const runDiff = useCallback(() => run("diff"), [run]);
  const runExplorer = useCallback(() => run("explorer"), [run]);
  const runStop = useCallback(() => run("stop"), [run]);
  const runRename = useCallback(() => run("rename"), [run]);
  const runRefresh = useCallback(() => run("refresh"), [run]);
  const handlers = useMemo<Record<SessionHeaderActionableId, () => void>>(
    () => ({
      files: runFiles,
      diff: runDiff,
      explorer: runExplorer,
      stop: runStop,
      rename: runRename,
      refresh: runRefresh,
    }),
    [runDiff, runExplorer, runFiles, runRefresh, runRename, runStop],
  );

  // 运行脚本 is the menu's one subpage (official scripts dropdown's sibling):
  // the page rows fire startWorkspaceScript/killTerminal themselves.
  const scriptsPages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: "scripts",
        title: t("header.menuScripts"),
        content: (
          <SessionHeaderScriptsPage
            serverId={workspace.serverId}
            workspaceId={workspace.workspaceId}
            scripts={scripts}
          />
        ),
      },
    ],
    [scripts, t, workspace.serverId, workspace.workspaceId],
  );

  // Stable style fn (the row-press pattern): an inline arrow would rebuild per render.
  const iconButtonStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.iconButton, pressed && styles.iconButtonPressed],
    [],
  );

  return (
    <>
      {/* C21 edge-back Pan: attached to the box-none layer, NOT a band View —
          a GestureDetector's own view is touchable on Android and a band would
          steal the left 32dp column's taps/scrolls from the session (measured).
          The layer is skipped by RN's hit-test, so touches land on the session
          underneath while RNGH still arbitrates the stream; the ≈32dp edge is
          the hook's start-x gate. The plain band View below is a layout/testID
          anchor for that edge only — and compact-only (C32 裁定 2): wide drops
          it, so the testID's absence is the on-device proof of the gate. */}
      <GestureDetector gesture={edgeGesture}>
        <View pointerEvents="box-none" style={styles.layer}>
          {edgeBackEnabled ? (
            <View
              pointerEvents="none"
              style={styles.edgeBand}
              testID={`shell-session-edge-band-${key}`}
            />
          ) : null}
          <View style={barStyle} testID={`shell-session-header-${key}`}>
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
              // C33 popover form needs an anchor: the engine measures this button
              // through its trigger ref (the row menus get it from ContextMenuTrigger).
              ref={menu.triggerRef}
              collapsable={false}
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
      </GestureDetector>
      <ContextMenuContent width={280} pages={scriptsPages} testID={`shell-session-menu-${key}`}>
        {sessionHeaderMenuPlan({
          stoppable,
          hasScripts: scripts.length > 0,
          isGit,
          hasCheckout,
          imported,
        }).map((item) => {
          if (item.id === "scripts") {
            return (
              <MenuSubTrigger
                key={item.id}
                id="scripts"
                disabled={!item.enabled}
                leading={actionLeading(item.id)}
                testID={`shell-session-menu-${item.id}`}
              >
                {t(HEADER_LABEL_KEY[item.id])}
              </MenuSubTrigger>
            );
          }
          return (
            <ContextMenuItem
              key={item.id}
              leading={actionLeading(item.id)}
              disabled={!item.enabled}
              onSelect={handlers[item.id]}
              testID={`shell-session-menu-${item.id}`}
            >
              {t(HEADER_LABEL_KEY[item.id])}
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
  edgeBand: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: SHELL_EDGE_BAND_WIDTH_DP,
  },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  title: {
    flex: 1,
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
