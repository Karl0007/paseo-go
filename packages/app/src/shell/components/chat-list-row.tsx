// Chat list row (DESIGN §4; WeChat-shaped since B4-ROW / batch-4 F4): project tile |
// title `项目(worktree)`, or the shell rename alone (D21, B6-TITLE) — with the running
// spinner and the absolute time on its right | unread badge (C18: dot only on idle
// rows, count pill only while approvals pend) | subtitle by priority
// `[草稿] `+draft > `[需要回复] `+preview > preview (`我: ` when the last message is the
// user's) > 占位小字 (B5-SUB: the line is ALWAYS there) | four-state light | ⋯ overflow.
// The clock lives in its own `<Text>`, so a minute tick never reaches the row; the
// draft read lives in the ROW (R4-13: the a11y label has to speak the subtitle, and
// `accessibilityLabel` replaces all child text), which is why a composer keystroke
// re-renders exactly the one row it belongs to. Tapping calls the screen's opener
// (C4: official navigateToAgent — workspace route + open intent — plus the read
// stamp; never the parse-stub push).
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
import { ActivityIndicator, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { MoreHorizontal } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  useShellRowDragMenu,
  type RowMenuController,
} from "@/shell/components/use-shell-row-drag-menu";
import { CONTEXT_MENU_DELAY_MS } from "@/shell/components/drag-menu-arbitration";
import {
  IDENTITY_COLOR_NAMES,
  IDENTITY_GLYPH_COLOR,
  identityColor,
  type IdentityColorName,
} from "@/styles/identity-colors";
import { projectAvatarFor } from "@/shell/chats/project-avatar";
import {
  buildChatSubtitle,
  buildChatRowTitle,
  selectSubtitlePreview,
  type ChatSubtitleSegment,
} from "@/shell/chats/row-title";
import { useWechatTimeLabel } from "@/shell/chats/use-wechat-time-label";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { showsUnreadDot, type ChatRow } from "@/shell/chats/derive";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellRenameHref } from "@/shell/routes";
import { ChatStatusLight } from "@/shell/components/chat-status-light";
import { useShellRowMenuStore } from "@/shell/components/chat-row-menu";
import type { Rect } from "@/components/ui/menu";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoStickyPreviewStore } from "@/shell/stores/stickyPreview";
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";
import { resolveProjectPlacement } from "@/utils/project-placement";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import { ownershipPresentation } from "@/shell/chats/ownership";
import { OwnershipBadge } from "@/shell/components/ownership-badge";

/** The derivation input widened with the live agent payload the row renders. */
export interface ShellChatAgent {
  key: string;
  serverId: string;
  lastActivityAt: number;
  attentionTimestamp: number | null;
  bucket: SidebarStateBucket;
  agent: AggregatedAgent;
}

/**
 * The row's red state words, AND the C9 search haystack's 最后动态 field — what the
 * user can see stays what they can search. B4-ROW rulings 1/5/8 cut this map down:
 * needs_input is the subtitle's 「[需要回复]」 prefix, failed keeps a red word
 * (ruling 8: 失败=红色 activity 词), running became the title-row spinner, and
 * attention/done never had a subtitle line to occupy — the unread dot carries them.
 */
export const ACTIVITY_LABEL_KEY: Record<SidebarStateBucket, string | null> = {
  needs_input: "chats.row.needsReply",
  failed: "chats.activity.failed",
  running: null,
  attention: null,
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

// Ruling 3: the tile is the PROJECT, not the provider. The identity palette is
// scheme-independent by construction (one muted fill per hue, tuned to one contrast
// band for a light glyph in either theme), so the ten backgrounds are built once here
// and every render hands Unistyles the SAME object — no inline style prop, no
// per-frame identity churn. The glyph takes `accentForeground`, the theme's own
// on-a-filled-chip text token (the unread count pill above pairs the same two), which
// keeps DESIGN §5's no-literal rule while the hue still reads at a glance.
const AVATAR_FILL = Object.fromEntries(
  IDENTITY_COLOR_NAMES.map((name) => [name, { backgroundColor: identityColor(name) }]),
) as Record<IdentityColorName, { backgroundColor: string }>;

// Ruling 8: running rides a 12dp spinner left of the time. A numeric `size` is what
// pins it (the official sidebar's archive spinner does the same at 8), and
// `withUnistyles` + a module-level mapping keeps the theme colour without a new object
// prop per render — the `size="small"` platform drawable measured ~20dp on the device.
const RUNNING_SPINNER_SIZE = 12;
const RunningSpinner = withUnistyles(ActivityIndicator);
const runningSpinnerColor = (theme: Theme) => ({ color: theme.colors.accent });

function ProjectAvatar({ projectName, rowKey }: { projectName: string; rowKey: string }) {
  const avatar = useMemo(() => projectAvatarFor(projectName), [projectName]);
  return (
    <View
      style={[styles.avatar, AVATAR_FILL[avatar.colorName]]}
      testID={`shell-chat-avatar-${rowKey}`}
    >
      <Text style={styles.avatarGlyph} numberOfLines={1}>
        {avatar.initial}
      </Text>
    </View>
  );
}

// Ruling 6: the time left the subtitle and became WeChat's absolute label, pinned
// right on the title line. Its state stays in this one `<Text>` — the same discipline
// the old relative clock used, so a tick never reaches the row.
function ChatTimestamp({ at }: { at: Date }) {
  const label = useWechatTimeLabel(at);
  if (label.length === 0) return null;
  return (
    <Text style={styles.time} numberOfLines={1}>
      {label}
    </Text>
  );
}

// R4-13 (review): the subtitle is BUILT IN THE ROW and rendered here, because the
// row's `accessibilityLabel` has to speak it — TalkBack got the whole subtitle
// replaced by the label, so a draft or a preview nobody put in the label was simply
// unsaid. One draft-store read serves both the pixels and the label; this component
// renders and subscribes to nothing. (The clock keeps its own `<Text>` — a minute
// tick still never reaches the row.)
function ChatSubtitle({ segments }: { segments: ChatSubtitleSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <Text style={styles.subtitle} numberOfLines={1}>
      {segments.map((segment) => (
        <Text key={segment.tone} style={segment.tone === "flag" ? styles.subtitleFlag : undefined}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

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
  // D21 (B6-TITLE / batch-6 F18): the row's 备注 is the shell rename and nothing
  // else. `agent.title` is NOT fed in — the daemon stamps it at birth with the
  // first prompt truncated (`deriveInitialAgentTitle`), so a session the user never
  // renamed used to render its prompt excerpt as the whole title line, which is not
  // the F12 default format. `buildChatRowTitle` keeps the `note` parameter for a
  // future explicit 备注 source; today the row passes none and the alias below wins
  // outright (C33's rename screen, the menu title and the delete confirm all read
  // the same alias).
  const projectName = useMemo(
    () =>
      resolveProjectPlacement({
        projectPlacement: agent.agent.projectPlacement,
        cwd: agent.agent.cwd,
      }).projectName,
    [agent.agent.projectPlacement, agent.agent.cwd],
  );
  const composedTitle = useMemo(
    () =>
      buildChatRowTitle({
        projectName,
        cwd: agent.agent.cwd,
        note: null,
      }),
    [projectName, agent.agent.cwd],
  );
  const displayTitle = alias ?? (composedTitle.length > 0 ? composedTitle : t("chats.untitled"));
  // R4-13: the subtitle is built HERE so the row's a11y label can speak it (see
  // `ChatSubtitle`). Ruling 2: it shows the composer's unsent text — the official
  // session composer's own key (`agent:${serverId}:${agentId}` = buildDraftStoreKey,
  // the exact call agent-panel.tsx passes to useAgentInputDraft), read through a
  // selector returning a primitive: the list only ever READS the draft store. One
  // subscription now serves the pixels and the label, so typing in a session
  // re-renders THAT row (memo keeps it to one) — the price of 「[草稿]」 being
  // audible at all. The clock still lives in its own `<Text>`: a minute tick never
  // reaches the row.
  const draftKey = useMemo(
    () => buildDraftStoreKey({ serverId: agent.serverId, agentId: agent.agent.id }),
    [agent.serverId, agent.agent.id],
  );
  const draftText = useDraftStore((state) => {
    const record = state.drafts[draftKey];
    return record?.lifecycle === "active" ? record.input.text : "";
  });
  const flagKey = ACTIVITY_LABEL_KEY[agent.bucket];
  // B5-SUB (F13): the directory merge is a whole-object replace and a pre-B4
  // daemon record reports the preview as null even for chats WITH messages, so a
  // blank incoming NEVER clears what the row has been showing — the shell store
  // keeps the last non-blank preview per chat (persisted; folded on every
  // directory pass by the screen). Selector returns a primitive: no new object
  // per render.
  const rememberedPreview = usePaseoGoStickyPreviewStore((state) => state.previews[agent.key]);
  const subtitlePreview = useMemo(
    () => selectSubtitlePreview(agent.agent.lastMessagePreview, rememberedPreview),
    [agent.agent.lastMessagePreview, rememberedPreview],
  );
  const subtitleSegments = useMemo(
    () =>
      buildChatSubtitle({
        draftText,
        flagLabel: flagKey ? t(flagKey) : null,
        preview: subtitlePreview,
        previewRole: agent.agent.lastMessageRole,
        labels: {
          draft: t("chats.row.draft"),
          userPrefix: `${t("chats.row.me")}: `,
          empty: t("chats.row.noMessages"),
        },
      }),
    [draftText, flagKey, t, subtitlePreview, agent.agent.lastMessageRole],
  );
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
  // B5-OWNVIS (F16/D19, 用户拍板): the ownership pill on the title line is now
  // ALWAYS there — 原生/外部/未知 (B4 rendered only the 外部 pair). The facts ride
  // the COMPAT(agentOwnership) passthrough; a pre-go.7 daemon's undefined pair
  // reads as 未知, which is the honest word for "an old host never told us".
  const ownershipView = ownershipPresentation({
    ownership: agent.agent.ownership,
    externalLooksActive: agent.agent.externalLooksActive,
  });
  // The spinner is invisible to TalkBack, so 运行中 stays a spoken word even though
  // ruling 8 took it off the screen.
  const rowLabel = [
    displayTitle,
    // R4-13: the subtitle line — 「[草稿] …」/「[需要回复] …」/「我: …」. `accessibilityLabel`
    // REPLACES every child text, so before this the draft and the last message were
    // unsaid to TalkBack: the eye's second line has to be the label's second phrase.
    subtitleSegments.map((segment) => segment.text).join(""),
    unread ? t("chats.a11yUnread") : null,
    activityLabelKey ? t(activityLabelKey) : null,
    agent.bucket === "running" ? t("chats.activity.running") : null,
    t(ownershipView.labelKey),
    dimmed ? t("chats.hostStatus.offline") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  const showSpinner = agent.bucket === "running";
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
        <ProjectAvatar projectName={projectName} rowKey={agent.key} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
              {displayTitle}
            </Text>
            <OwnershipBadge
              ownership={agent.agent.ownership}
              externalLooksActive={agent.agent.externalLooksActive}
              testID={`shell-chat-ownership-${agent.key}`}
            />
            {showSpinner ? (
              <RunningSpinner
                size={RUNNING_SPINNER_SIZE}
                uniProps={runningSpinnerColor}
                testID={`shell-chat-running-${agent.key}`}
              />
            ) : null}
            <ChatTimestamp at={agent.agent.lastActivityAt} />
            <ChatBadge
              bucket={agent.bucket}
              count={pendingCount}
              unread={unread}
              rowKey={agent.key}
            />
          </View>
          <ChatSubtitle segments={subtitleSegments} />
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
  // Ruling 3: 40dp rounded tile, WeChat's proportion for a conversation avatar,
  // filled with the project's hash colour (AVATAR_FILL).
  // B4-ROW tail (dark frame): the glyph is the palette's one light letter, NOT
  // `accentForeground` — in dark that token is #18181b (for the near-white accent
  // chip) and measures 3.76-4.14:1 on these fills, under the 4.5:1 text floor.
  avatar: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: IDENTITY_GLYPH_COLOR,
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
  // Ruling 6: the time sits at the title line's right edge, quiet and small — the
  // title flexes, this never does.
  time: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
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
  // Rulings 2/5: the bracketed state mark, red on the muted body.
  subtitleFlag: {
    color: theme.colors.destructive,
  },
}));
