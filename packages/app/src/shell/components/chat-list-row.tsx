// Chat list row (DESIGN §4; WeChat-shaped since B4-ROW / batch-4 F4): project tile |
// title `项目(worktree)`, or the shell rename alone (D21, B6-TITLE) — with the running
// spinner and the absolute time on its right | the unread marker — ONE slot, right
// of the clock (F32; C18: dot only on idle rows, count pill only while approvals
// pend) | 子任务 chip (B9-SUBACT + REVIEW-B9-03: icon+digit after the marker; the
// word 「子任务」 is spoken in the row's a11y label) | subtitle by priority
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
import { FONT_SIZE, SPACING, type Theme } from "@/styles/theme";
import { MoreHorizontal, Users } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  useShellRowDragMenu,
  type RowMenuController,
} from "@/shell/components/use-shell-row-drag-menu";
import { CONTEXT_MENU_DELAY_MS } from "@/shell/components/drag-menu-arbitration";
import { IDENTITY_GLYPH_COLOR } from "@/styles/identity-colors";
import { AVATAR_FILL, projectAvatarFor } from "@/shell/chats/project-avatar";
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
import { ChatStatusLight, STATUS_LIGHT_WIDTH_DP } from "@/shell/components/chat-status-light";
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

// C18 双点收敛 + F32 (B9-BADGE) — the row wears ONE unread marker, in ONE slot:
// right of the clock, inside the right-edge group. REVIEW-B9-08 口径: the GROUP
// owns the title line's tail — the 子任务 chip sits after the marker, the marker
// keeps its F32 slot. Two judgements live here — the count pill is a state marker
// (approvals pend) and renders on count>0 alone, because permission requests carry
// no attention stamp, so gating it on `unread` would make it vanish; the dot is
// the unread mark and only ever shows on idle rows (showsUnreadDot) — active
// buckets wear their state on the status light + bold title, never a second dot.
// Whichever branch fires, the other stays unrendered, so a row can never show two
// markers. The chip members wear the slotChip base (REVIEW-B9-07); the dot is the
// family's 8dp POINT tier and stays outside the base by design.
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
      <View style={styles.countBadge} testID={`shell-chat-count-${rowKey}`}>
        <Text style={styles.countBadgeText}>{count}</Text>
      </View>
    );
  }
  if (unread && showsUnreadDot(bucket, count)) {
    return <View style={styles.unreadDot} testID={`shell-chat-unread-${rowKey}`} />;
  }
  return null;
}

// B9-SUBACT (F31 ruling B+) + REVIEW-B9-03 (D6): the 子任务 chip — the watcher saw
// N of this agent's omp child transcripts written inside the freshness window:
// foreign subagent work is running under this session. The pixels are ICON+DIGIT
// (lucide `Users` + the count) so the chip's width is locale-independent and lands
// in the count pill's tier — the 「子任务×N」 word string it replaces measured 63dp
// in zh (wider in en) and pushed the shrink-0 right-edge group over the title
// line's box (f6 frame: the light and ⋯ covered, the title at 0 width). The word
// 「子任务」 is spoken in the row's a11y label (`chats.subagents.badge`, reworded
// for the ear) and the long-press menu is untouched. The chip wears the slotChip
// base (REVIEW-B9-07) + the pill's quietest color pair (REVIEW-B8-10 D6), and sits
// AFTER the unread marker inside the right-edge group: the GROUP owns the line's
// tail (REVIEW-B9-08), same-screen order spinner → clock → unread → 子任务.
// `0`/absent never renders (COMPAT(subagentActivity)): the count decaying to 0 is
// the chip's off switch.
function SubagentBadge({ count, rowKey }: { count: number; rowKey: string }) {
  if (!(count > 0)) {
    return null;
  }
  return (
    <View style={styles.subagentBadge} testID={`shell-chat-subagents-${rowKey}`}>
      <Users
        size={SUBAGENT_GLYPH_DP}
        color={styles.subagentGlyph.color}
        style={styles.subagentGlyph}
      />
      <Text style={styles.subagentBadgeText}>{count}</Text>
    </View>
  );
}

// Ruling 3: the tile is the PROJECT, not the provider. The fill table lives in
// `shell/chats/project-avatar` (REVIEW-B8-05) — the import row imports the SAME
// object, so a palette edit moves both screens in one commit and the
// 「同项目同色」 invariant cannot drift per-file. Scheme-independent by
// construction (ten muted fills, one contrast band for a light glyph in either
// theme), built once at module scope: no inline style prop, no per-frame
// identity churn. The glyph takes `IDENTITY_GLYPH_COLOR`, the palette's own
// light-glyph constant, which keeps DESIGN §5's no-literal rule.

// Ruling 8: running rides a 12dp spinner left of the time. A numeric `size` is what
// pins it (the official sidebar's archive spinner does the same at 8), and
// `withUnistyles` + a module-level mapping keeps the theme colour without a new object
// prop per render — the `size="small"` platform drawable measured ~20dp on the device.
const RUNNING_SPINNER_SIZE = 12;
const RunningSpinner = withUnistyles(ActivityIndicator);
const runningSpinnerColor = (theme: Theme) => ({ color: theme.colors.accent });

// REVIEW-B9-07 (裁定=共享基座): the right-edge slot family's shared geometry —
// the theme-free properties; the `slotChip` base inside `styles` adds the theme's
// `borderRadius.full` + `spacing[1.5]` on top. The count pill and the 子任务 chip
// consume that base and add ONLY a color pair; the 8dp unread dot is the family's
// POINT tier and stays out. The hand-copied properties were the drift surface
// (REVIEW-B8-05 同型) — a geometry edit now moves both chips in one commit, which
// is what the base-consumption test pins. `flexDirection: row` is family geometry,
// not a member extra: a chip lays its content out horizontally — one digit in the
// count pill, glyph+digit in the 子任务 chip (the device frame caught the column
// default stacking them at 18dp height).
export const SLOT_CHIP_DP = {
  minWidth: 18,
  height: 18,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
} as const;

// REVIEW-B9-03 (D6): the fixed widths the title line spends, in ONE table. The
// row chrome (avatar tile, ⋯ glyph, status light through its own export) and the
// 子任务 chip's glyph tier are named here so the budget sum and the render path
// read the SAME numbers; the row test mirrors the chrome members against the DOM,
// so a style edit that skips the table goes red.
const SUBAGENT_GLYPH_DP = 12; // lucide `Users` at the chip's small tier (12-14 band, low end)
const SUBAGENT_GLYPH_GAP_DP = SPACING[0.5];
const AVATAR_SIZE_DP = 40;
const MORE_GLYPH_DP = 16;

/**
 * REVIEW-B9-03: the title line's width budget. jsdom has no layout engine, so the
 * f6 overflow — an unbounded localized word string riding the shrink-0 right-edge
 * group, 197px over the line with the light and ⋯ covered and the title at 0 —
 * was CI-invisible. The budget test sums the scenario slots' INTRINSIC widths
 * (this table + `measureTextDp` over the text the DOM actually shows) and
 * compares against the title line's box at the narrowest compact list width on
 * record. Scope, stated honestly:
 * - 380dp is the compact floor the chats-header tier table registers (「三档仍钉在
 *   现实宽度 260 md / 300 lg / ≥380 紧凑」; 「380-405dp 电话」 is the narrowest
 *   on-record band). The tablet md column (260dp) sits BELOW the box this family
 *   can ever hold — clock + count pill + ownership already exceed it — that
 *   squeeze is the header's registered tier problem, not this card's regression.
 * - The ownership pill is not in the ruling's scenario (running + pending 1 +
 *   subagents 2 + short title): it is the identity axis untouched by this card,
 *   and in jsdom its text is the echo-mock key — measuring it would measure the
 *   mock, not the design.
 */
export const TITLE_LINE_BUDGET_DP = {
  narrowestCompactWidthDp: 380,
  rowPaddingHorizontalDp: SPACING[4], // per side — styles.row
  avatarDp: AVATAR_SIZE_DP,
  rowGapDp: SPACING[3], // per gap — styles.row (two gaps flank the body)
  statusLightDp: STATUS_LIGHT_WIDTH_DP,
  morePaddingHorizontalDp: SPACING[3], // per side — styles.moreButton
  moreGlyphDp: MORE_GLYPH_DP,
  slotGapDp: SPACING[2], // per gap — titleRow + titleTrailing
  spinnerDp: RUNNING_SPINNER_SIZE,
  chipMinWidthDp: SLOT_CHIP_DP.minWidth,
  chipHeightDp: SLOT_CHIP_DP.height,
  chipPaddingHorizontalDp: SPACING[1.5], // per side — the slotChip base
  subagentGlyphDp: SUBAGENT_GLYPH_DP,
  subagentGlyphGapDp: SUBAGENT_GLYPH_GAP_DP,
  titleFontSizeDp: FONT_SIZE.base,
  smallTierFontSizeDp: FONT_SIZE.sm, // the clock + the chip digits
} as const;

/** The chrome the title line never gets back: row padding + avatar + the two row
 * gaps + the status light + the ⋯ button. */
export const TITLE_LINE_CHROME_DP =
  TITLE_LINE_BUDGET_DP.rowPaddingHorizontalDp * 2 +
  TITLE_LINE_BUDGET_DP.avatarDp +
  TITLE_LINE_BUDGET_DP.rowGapDp * 2 +
  TITLE_LINE_BUDGET_DP.statusLightDp +
  TITLE_LINE_BUDGET_DP.morePaddingHorizontalDp * 2 +
  TITLE_LINE_BUDGET_DP.moreGlyphDp;

/** Per-glyph width tiers in em — conservative for the shell's Roboto family:
 * CJK full-width, digits 0.56em, narrow punctuation 0.35em, space 0.25em,
 * everything else 0.55em. No layout engine required. */
export function measureTextDp(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) {
    const c = char.codePointAt(0) as number;
    if (
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
    ) {
      em += 1;
    } else if (c >= 0x30 && c <= 0x39) {
      em += 0.56;
    } else if (char === " ") {
      em += 0.25;
    } else if (":;-_|!.,'".includes(char)) {
      em += 0.35;
    } else {
      em += 0.55;
    }
  }
  return em * fontSize;
}

/** The ruling's scenario: what one title line has to hold. A `null` slot is not
 * rendered (no spinner / no count pill / no 子任务 chip). */
export interface TitleLineScenario {
  titleText: string;
  spinner: boolean;
  clockText: string;
  countText: string | null;
  subagentCountText: string | null;
}

/** The scenario's intrinsic sum: the title, the right-edge group (spinner →
 * clock → count pill → 子任务 chip) and the flex gaps between them. Compare
 * against `TITLE_LINE_BUDGET_DP.narrowestCompactWidthDp - TITLE_LINE_CHROME_DP`. */
export function titleLineWidthDp(scenario: TitleLineScenario): number {
  const B = TITLE_LINE_BUDGET_DP;
  const chipWidthDp = (digits: string, glyphDp: number): number =>
    Math.max(
      B.chipMinWidthDp,
      glyphDp + measureTextDp(digits, B.smallTierFontSizeDp) + B.chipPaddingHorizontalDp * 2,
    );
  const trailing: number[] = [];
  if (scenario.spinner) trailing.push(B.spinnerDp);
  trailing.push(measureTextDp(scenario.clockText, B.smallTierFontSizeDp));
  if (scenario.countText !== null) trailing.push(chipWidthDp(scenario.countText, 0));
  if (scenario.subagentCountText !== null) {
    trailing.push(
      chipWidthDp(scenario.subagentCountText, B.subagentGlyphDp + B.subagentGlyphGapDp),
    );
  }
  // One gap joins the title to the group, one between every group pair: n gaps.
  return (
    measureTextDp(scenario.titleText, B.titleFontSizeDp) +
    B.slotGapDp * trailing.length +
    trailing.reduce((sum, width) => sum + width, 0)
  );
}

/** The width the ownership pill keeps in its TRUNCATED state: side padding +
 * one ellipsis glyph (REVIEW-B9-03 Main 裁定 B — the pill is the title line's
 * secondary relief valve: bounded by truncation, never by a maxWidth special). */
export const TITLE_LINE_PILL_FLOOR_DP = SPACING[1.5] * 2 + measureTextDp("…", FONT_SIZE.sm);

/** The extreme stack's floor — the f6 scene: the two truncatable members at
 * their minimums (title at 0, ownership pill at its ellipsis floor) and the
 * right-edge group at FULL intrinsic width. The group never truncates; that is
 * the whole point of the icon+digit chip. Compare against a concrete column's
 * box, e.g. the tablet lg list column: 300 − TITLE_LINE_CHROME_DP. */
export function titleLineFloorWidthDp(
  scenario: Omit<TitleLineScenario, "titleText"> & { ownershipPill: boolean },
): number {
  const B = TITLE_LINE_BUDGET_DP;
  const noTitle = titleLineWidthDp({ ...scenario, titleText: "" });
  // The pill sits between the title and the group: it costs its floor plus one
  // extra gap; the title's own slot collapses to zero width.
  return noTitle + (scenario.ownershipPill ? B.slotGapDp + TITLE_LINE_PILL_FLOOR_DP : 0);
}

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

// Ruling 6 + F21 (B8-ROWPILL): WeChat's line — the absolute time is pinned to the
// title line's RIGHT edge (inside `titleTrailing`), so any title length leaves it
// in place instead of trailing the pill. Its state stays in this one `<Text>` —
// the same discipline the old relative clock used, so a tick never reaches the row.
function ChatTimestamp({ at, testID }: { at: Date; testID?: string }) {
  const label = useWechatTimeLabel(at);
  if (label.length === 0) return null;
  return (
    <Text style={styles.time} numberOfLines={1} testID={testID}>
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
    () => ({
      key: agent.key,
      serverId: agent.serverId,
      agentId: agent.agent.id,
      // F37-v2: 刷新 grades these before resuming (the send guard's table).
      ownership: agent.agent.ownership,
      externalLooksActive: agent.agent.externalLooksActive,
      provider: agent.agent.provider,
    }),
    [
      agent.key,
      agent.serverId,
      agent.agent.id,
      agent.agent.ownership,
      agent.agent.externalLooksActive,
      agent.agent.provider,
    ],
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
  // ALWAYS there — 原生/外部/未知 (B4 rendered only the 外部 pair). B6-OWN-HEAL
  // (F19/D22) adds the third fact: with no live-writer evidence the pill answers
  // from the COMPAT(agentOrigin) birth axis, so an idle launched session reads 原生
  // and an imported one 外部 instead of 未知; 未知 is left to a host that reported
  // neither axis.
  const ownershipView = ownershipPresentation({
    ownership: agent.agent.ownership,
    externalLooksActive: agent.agent.externalLooksActive,
    origin: agent.agent.origin,
  });
  // The spinner is invisible to TalkBack, so 运行中 stays a spoken word even though
  // ruling 8 took it off the screen.
  // B9-SUBACT + REVIEW-B9-03 (D6): the chip's pixels are icon+digit; the word
  // 「子任务」 lives HERE — `accessibilityLabel` replaces every child text, so a
  // fact the label does not say is simply unsaid to TalkBack. One derived string
  // feeds the label; the locale key kept its name, its wording moved to the ear.
  const subagentCount = agent.agent.activeSubagents ?? 0;
  const subagentLabel = subagentCount > 0 ? t("chats.subagents.badge", { n: subagentCount }) : null;
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
    subagentLabel,
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
            <Text
              style={[styles.title, unread && styles.titleUnread]}
              numberOfLines={1}
              testID={`shell-chat-title-${agent.key}`}
            >
              {displayTitle}
            </Text>
            <OwnershipBadge
              ownership={agent.agent.ownership}
              externalLooksActive={agent.agent.externalLooksActive}
              origin={agent.agent.origin}
              testID={`shell-chat-ownership-${agent.key}`}
            />
            {/* F21 + F32 + REVIEW-B9-03: the right-edge group — spinner (ruling 8:
                still left of the time), the clock, then the unread slot, then the
                子任务 chip. The GROUP is the title line's last pixel (REVIEW-B9-08
                口径: the tail belongs to the group, never to one member). F32 moved
                the marker out from between spinner and clock: one unread marker per
                row, right of the clock; B9-SUBACT's chip joined the family AFTER it
                (F31 ruling: same-screen order spinner → time → unread → 子任务).
                The group eats the leftover width, so the title truncates first and
                nothing in the group gets squeezed — which is exactly why every
                member is width-bounded: the REVIEW-B9-03 budget table + test keep
                the group's intrinsic sum inside the title line's box. */}
            <View style={styles.titleTrailing}>
              {showSpinner ? (
                <RunningSpinner
                  size={RUNNING_SPINNER_SIZE}
                  uniProps={runningSpinnerColor}
                  testID={`shell-chat-running-${agent.key}`}
                />
              ) : null}
              <ChatTimestamp
                at={agent.agent.lastActivityAt}
                testID={`shell-chat-time-${agent.key}`}
              />
              <ChatBadge
                bucket={agent.bucket}
                count={pendingCount}
                unread={unread}
                rowKey={agent.key}
              />
              <SubagentBadge count={subagentCount} rowKey={agent.key} />
            </View>
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
        <MoreHorizontal size={MORE_GLYPH_DP} color={styles.moreIcon.color} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  // REVIEW-B9-07 (裁定=共享基座): the right-edge slot family's shared geometry —
  // the base below, ONE source; countBadge/subagentBadge spread it and add ONLY
  // their color pair. The 8dp unread dot is the family's point tier, out by design.
  const slotChip = {
    ...SLOT_CHIP_DP,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[1.5],
  };
  return {
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
      width: AVATAR_SIZE_DP,
      height: AVATAR_SIZE_DP,
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
    // F21 (B8-ROWPILL) + F32 (B9-BADGE): title + pill own the line's left, this
    // group owns its right edge — flexGrow takes the leftover width, flex-end pins
    // the content to it, flexShrink 0 means a long title squeezes the TITLE (ruling
    // 6's posture), never the clock or a marker out of the row. The group is the
    // title line's last pixel (REVIEW-B9-08 口径: the tail belongs to the GROUP);
    // inside it the order is spinner → clock → marker → 子任务 chip.
    titleTrailing: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      flexGrow: 1,
      flexShrink: 0,
      justifyContent: "flex-end",
    },
    // Ruling 6 + F21: the time is the row's right-edge label — the theme's smallest
    // text tier (`sm` = 12, the xs band; the theme has no smaller token), muted
    // grey, and it never shrinks.
    time: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      flexShrink: 0,
    },
    title: {
      flexShrink: 1,
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    titleUnread: {
      fontWeight: theme.fontWeight.bold,
    },
    // F32: the marker never shrinks — a long title truncates the TITLE (ruling 6),
    // not the unread mark. The 8dp POINT tier: outside the slotChip base by design.
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.accent,
      flexShrink: 0,
    },
    // F32: the count pill — the unread slot's state-marker branch: the slotChip
    // base + the warning pair, nothing else (REVIEW-B9-07).
    countBadge: { ...slotChip, backgroundColor: theme.colors.statusDotWarning },
    countBadgeText: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.accentForeground,
    },
    // B9-SUBACT + REVIEW-B9-03 (D6): the 子任务 chip — the slotChip base + the
    // pill's quietest grade for color (REVIEW-B8-10 D6: the tint fill + full-depth
    // word of one hue; surface2+foregroundMuted sits under AA and is banned here).
    subagentBadge: {
      ...slotChip,
      backgroundColor: theme.colors.statusNeutralTint,
    },
    subagentGlyph: {
      marginRight: theme.spacing[0.5],
      color: theme.colors.statusNeutral,
    },
    subagentBadgeText: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.statusNeutral,
    },
    subtitle: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    // Rulings 2/5: the bracketed state mark, red on the muted body.
    subtitleFlag: {
      color: theme.colors.destructive,
    },
  };
});
