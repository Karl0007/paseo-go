// C14 shell session header / C21 top replacement (DESIGN §14.5, card C21): the
// full-width bar the shell floats over the official session screen, replacing it.
// C14 proved the official compact header has no injection point and is ALWAYS
// visible (shouldShowWorkspaceScreenHeader = !focusMode || isMobile); the C14
// bottom-coexistence branch was overturned by the C21 ruling — the bar sits at
// the very top. KI-14 (用户拍板 2026-09-29) then landed the upstream touchpoint
// COMPAT(shellHideOfficialSessionChrome) and KI-17② (编排者拍板 2026-09-30)
// widened its gate to shellActive alone: on BOTH form factors the official
// header band + tab rows are UNMOUNTED in-flow, so the bar is pure two-line
// content height (44/34) + status-bar inset — no cover compensation, nothing
// left to paint out. The header's controls (hamburger drawer, official ⋯,
// scripts button, explorer toggle) being gone from the screen is the point;
// their useful half is aggregated into the
// capsule menu (see session-header/visibility for the matrix): 查看项目文件 /
// 查看 diff / 运行脚本 / 停止 / 重命名 — KI-9 收敛: both view rows push the ONE
// (detail) files screen with the initial tab (files|diff), the C21 打开文件浏览器
// row is deleted (same engine, redundant container); the scripts page rides the
// official startWorkspaceScript/killTerminal RPCs.
//
// KI-8 (用户拍板 2026-09-29): the bar is TWO lines — 首行（主字重）`<项目> · <分支>`
// (项目=壳内既有 workspace label 链；分支=既有 checkout_status 查询，非 git/未回
// 只显项目名，零占位零骨架), 次行（muted 小字）=会话真标题; 状态点跟首行对齐，
// 返回/⋯ 位置与命中区不动。内容与高度数学全是纯函数（session-header/
// compact-rows + compact-rows.test.ts 钉值）。
//
// Edge gestures are re-routed for the capsule's whole visible span: the
// provider's symbol-keyed open-gesture blocker parks the official left-open
// (agent list) and right-open (explorer) swipes and releases them on unmount
// (shell-off / non-session routes see zero behaviour change), while a
// transparent 32dp left-edge band carries the shell's own rightward-swipe →
// the same back verb (shell-header/edge-swipe + use-shell-edge-back-gesture,
// KI-17③: detailBack — pop, or replace onto (shell)/chats on a headless stack).
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
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useBlockMobilePanelOpenGestures } from "@/mobile-panels/provider";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL, shellFilesHref, shellRenameHref } from "@/shell/routes";
import { detailBack } from "@/shell/detail-back";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoShellActive } from "@/shell/stores/settings";
import { useShellAgentActions, type ShellChatTarget } from "@/shell/shellAgentActions";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import { OwnershipBadge } from "@/shell/components/ownership-badge";
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
import {
  SESSION_HEADER_CONTROL_HEIGHT_DP,
  TEXT_LINE_HEIGHT_CEILING,
  resolveSessionHeaderBranch,
  resolveSessionHeaderProjectLabel,
  resolveSessionHeaderRows,
  sessionHeaderBandBottomDp,
  sessionHeaderTopPadDp,
  type SessionHeaderRows,
} from "@/shell/session-header/compact-rows";

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
const ThemedPlay = withUnistyles(Play, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedSquare = withUnistyles(Square, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPenLine = withUnistyles(PenLine, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedRefreshCw = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const HEADER_LABEL_KEY: Record<SessionHeaderActionId, string> = {
  files: "header.menuFiles",
  diff: "header.menuDiff",
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

  // KI-8 首行数据：项目=壳内既有 workspace label 链（workspace-command-row/
  // workspace-favorite-row 同源）；分支=既有 checkout_status 查询（文件屏同款，
  // 零新 RPC、push-driven 缓存；descriptor 未回时 cwd="" → 查询 disabled，
  // status 恒 null → 只显项目名，不显占位符、不闪骨架）。
  const checkoutCwd = descriptor?.workspaceDirectory ?? "";
  const checkoutStatus = useCheckoutStatusQuery({
    serverId: workspace.serverId,
    cwd: checkoutCwd,
  });
  const headerBranch = resolveSessionHeaderBranch(checkoutStatus.status);
  const headerProjectLabel = resolveSessionHeaderProjectLabel(descriptor);
  const headerRows = useMemo(
    () =>
      resolveSessionHeaderRows({
        projectLabel: headerProjectLabel,
        branch: headerBranch,
        title: displayTitle,
      }),
    [headerProjectLabel, headerBranch, displayTitle],
  );

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

  // KI-14 (用户拍板 2026-09-29; KI-17② 扩面 2026-09-30): the official session
  // chrome — header band (compact AND wide), mobile tab row, desktop fallback
  // tabs row — is UNMOUNTED in-flow by the workspace-screen touchpoint
  // (COMPAT(shellHideOfficialSessionChrome), gate = shellActive alone), so the
  // bar no longer doubles as a cover — R2-08③'s tab-row-cover and KI-8's cover
  // compensation are retired with them (关 tab→归档 is structurally
  // unreachable, not painted out). The bar IS the header: top-anchored full
  // width, pure two-line content height + status-bar inset, opaque surface0
  // with the shared bottom-border token. paddingBottom keeps the controls +
  // two lines centered in the inner box. The height math is compact-rows'
  // `sessionHeaderBandBottomDp` — the SAME source KI-17① pads the session
  // content column with, so bar bottom and content top can never drift.
  const barStyle = useMemo(() => {
    return [
      styles.bar,
      {
        height: sessionHeaderBandBottomDp(insets.top, isCompact),
        paddingTop: insets.top + sessionHeaderTopPadDp(isCompact),
      },
    ];
  }, [insets.top, isCompact]);

  const goBack = useCallback(() => {
    // Same verb as the system back and the edge swipe: pops the official screen
    // onto the shell list (C4's push-verb entry keeps that list mounted below).
    // KI-17③: on a headless cold deep-link stack (no `(shell)` beneath — the
    // capsule now shows there too) there is nothing to pop, so detailBack
    // replaces onto the shell chats list instead of stranding the screen.
    detailBack(SHELL.chats);
  }, []);
  const openMenu = useCallback(() => menu.setOpen(true), [menu]);

  // The dispatch table is the pure `createSessionHeaderRunner` (matrix test pins
  // it). KI-9 菜单收敛: 查看项目文件 / 查看 diff both push the ONE (detail) files
  // screen (C16 single instance) with the initial tab — a real root-Stack push on
  // top of the session screen, so hardware/gesture back pops right back here, and
  // the two rows no longer open two different containers with two different
  // transition idioms. 重命名 (C33) likewise pushes the (detail) rename screen:
  // back returns to the session (the hidden-tab navigate-reuse 回列表 detour is
  // retired). The C21 打开文件浏览器 row is deleted; the official explorer
  // overlay itself stays reachable through the official keyboard-action path
  // (workspace-screen handleWorkspacePanelOpenAction), which the capsule never
  // owned.
  const run = useMemo(
    () =>
      createSessionHeaderRunner({
        openFiles: () =>
          router.push(shellFilesHref(workspace.serverId, workspace.workspaceId, "files")),
        openDiff: () =>
          router.push(shellFilesHref(workspace.serverId, workspace.workspaceId, "diff")),
        stop: () => void actions.stop(target),
        openRename: () => router.push(shellRenameHref(target)),
        refresh: () => void actions.refresh(target),
      }),
    [actions, target, workspace.serverId, workspace.workspaceId],
  );
  const runFiles = useCallback(() => run("files"), [run]);
  const runDiff = useCallback(() => run("diff"), [run]);
  const runStop = useCallback(() => run("stop"), [run]);
  const runRename = useCallback(() => run("rename"), [run]);
  const runRefresh = useCallback(() => run("refresh"), [run]);
  const handlers = useMemo<Record<SessionHeaderActionableId, () => void>>(
    () => ({
      files: runFiles,
      diff: runDiff,
      stop: runStop,
      rename: runRename,
      refresh: runRefresh,
    }),
    [runDiff, runFiles, runRefresh, runRename, runStop],
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
            <HeaderRowsText rows={headerRows} agent={agent} bucket={bucket} targetKey={key} />
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

// KI-8 双行文本列（自 CapsuleInner 抽出：行态/testID 落点的三元在这里，宿主
// 组件复杂度留在闸内）。首行=项目·分支（主字重，状态点跟首行对齐——横向仍是
// 原标题列右缘），次行=会话真标题（muted 小字）单行截断；无项目名（descriptor
// 未回）时退化为单行=标题，shell-session-title testID 恒落标题文本。
function HeaderRowsText({
  rows,
  agent,
  bucket,
  targetKey,
}: {
  rows: SessionHeaderRows;
  agent: AggregatedAgent;
  bucket: SidebarStateBucket;
  targetKey: string;
}) {
  return (
    <View style={styles.textColumn}>
      <View style={styles.primaryRow}>
        <Text
          style={styles.primary}
          numberOfLines={1}
          testID={
            rows.secondary !== null
              ? `shell-session-project-${targetKey}`
              : `shell-session-title-${targetKey}`
          }
        >
          {rows.primary}
        </Text>
        {/* B4-OWNERSHIP-UI (ruling 14): same 「外部」 pill as the chat row, riding
            the focused agent's COMPAT(agentOwnership) pair; the status light keeps
            the far-right slot. */}
        <OwnershipBadge
          ownership={agent.ownership}
          externalLooksActive={agent.externalLooksActive}
          testID={`shell-session-ownership-${targetKey}`}
        />
        <ChatStatusLight agent={agent} bucket={bucket} />
      </View>
      {rows.secondary !== null ? (
        <Text
          style={styles.secondary}
          numberOfLines={1}
          testID={`shell-session-title-${targetKey}`}
        >
          {rows.secondary}
        </Text>
      ) : null}
    </View>
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
  // KI-8 双行文本列：显式 lineHeight（compact-rows 的 TEXT_LINE_HEIGHT_CEILING
  // base+sm 两行块（17+15=32dp）装得进最紧的 wide inner=34，且不随 Android
  // fontScale 漂移——compact-rows.test.ts 钉这块算术。
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  primaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  primary: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: Math.ceil(theme.fontSize.base * TEXT_LINE_HEIGHT_CEILING),
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  secondary: {
    fontSize: theme.fontSize.sm,
    lineHeight: Math.ceil(theme.fontSize.sm * TEXT_LINE_HEIGHT_CEILING),
    color: theme.colors.foregroundMuted,
  },
  iconButton: {
    width: SESSION_HEADER_CONTROL_HEIGHT_DP,
    height: SESSION_HEADER_CONTROL_HEIGHT_DP,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: SESSION_HEADER_CONTROL_HEIGHT_DP / 2,
    flexShrink: 0,
  },
  iconButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
}));
