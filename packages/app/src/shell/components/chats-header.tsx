// 对话 tab top bar (KI-12 统一容器 + B4-F1 单行化：60dp 定高、inset 一次、列表外)。
// DESIGN §4: 连接状态胶囊 (tap = per-host status popover with single-host retry) sits
// in the bar's right slot; B4-F2 裁定 2/Q1: the pill label is the bare count
// 「● online/total」(hostsOnlineCount) — the dot carries the global state, the menu
// still shows per-host detail; 无主机态 keeps 「无主机」. The 进行中/已归档 filter
// segment (C3) rode the old accessory band; B4-F1 裁定 1/F3 moved it INTO the bar
// row (标题+胶囊+segment+搜索+＋ 单行). Q2 三档降级: the header measures its own row
// width (onLayout; window-form-factor seed for the first frame) and the segment
// steps 全称 → 短称 → 纯图标 (archived count survives all three tiers — C3's
// 「隐藏堆可见」). R4-05: the tier is decided by MEASURED widths (pill + segment
// group vs the column), not by a dp table written for one language's glyphs.
// 搜索 (C9: the icon morphs the bar into input + 取消, filtering the list instantly).
// ＋菜单 (新建对话 = C17 direct push of the official /new screen (DESIGN §14.7),
// 导入会话 = C10 push of the shell import screen). Menus ride the official menu
// engine in its anchored-popover presentation (C19, DESIGN §14.3): the engine
// default compact mode, anchoring under the trigger and clamping at the right edge.
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, Pressable, Text, View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Archive, Inbox, MessageSquarePlus, Play, Plus, Search, Server } from "lucide-react-native";
import { HostStatusDot } from "@/components/host-status-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import type { HostProfile } from "@/types/host-connection";
import { SearchModeBar } from "@/shell/components/search/search-mode-bar";
import { ShellTabHeader } from "@/shell/components/shell-tab-header";
import { isCompactWindowWidth, tabletColumnsForWidth } from "@/shell/tablet/form-factor";

const HOST_STATUS_LABEL_KEY: Record<HostRuntimeConnectionStatus, string> = {
  idle: "chats.hostStatus.idle",
  connecting: "chats.hostStatus.connecting",
  online: "chats.hostStatus.online",
  offline: "chats.hostStatus.offline",
  error: "chats.hostStatus.error",
};

// ---------------------------------------------------------------------------
// B4-F1/Q2: segment 三级降级。R4-05 复核（MatePad BRT-W09 @400dpi，uiautomator
// bounds 实测，px/2.5=dp）证明「只按列宽断点分档」是单语种算术：同一字号 en 比 zh
// 宽得多——300dp lg 列 en 短称档实测溢出 16dp（＋ 被推出列边界），380-405dp 电话
// en 全称档溢出 31.6dp（标题只剩 36dp 截成「Cha…」，＋ 出界）；归档计数 1→128 还要
// 再吃 ~12dp。静态预算盖不住这两个自由度。
//
// 实测台账（固定件 = 列内衬 16×2 + 槽位 gap 8×3 + 搜索/＋ 32×2 = 120）：
//   胶囊「1/2」62.8dp（窄档收内边距后 54.8）/ 图标档裸点 34（窄档 26）
//   segment 组：zh 全称 145 / zh 短称 119.6→103.6(窄档) / en 全称 185.6 /
//             en 短称 134.4→118.4(窄档) / 图标档 95.6→79.6(窄档)
//   标题：en「Chats」55.2 / zh「对话」40
// 所以断点只当**首帧种子 + 上限**（三档仍钉在现实宽度 260 md / 300 lg / ≥380 紧凑），
// 真档位由 `chatFilterSegmentFitsTier` 用 onLayout 实测宽决定：装不下就降一档，
// 降完还装不下就退图标档；标题另过 `chatFilterTitleFits` 的宽门（宁可无标题，
// 不出现「Cha…」）。窄两档（short/icon）的内边距收 12→8，给 en 短称挤出 24dp。
//   seed: width < 280 → icon | 280 ≤ width < 380 → short | width ≥ 380 → full
// ---------------------------------------------------------------------------

export type ChatFilterSegmentTier = "full" | "short" | "icon";
/** 短称档下限（列宽）：低于它 segment 退纯图标。 */
export const CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP = 280;
/** 全称档下限（列宽）：低于它退短称。 */
export const CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP = 380;
/**
 * 标题的最小留宽：低于它宁可无标题。实测 zh「对话」40dp / en「Chats」55.2dp，
 * 52 = 两语种都能完整显示的下限（R4-05 的「标题饿死」= 全称档在 380-405dp 电话上
 * 只剩 36dp，截成「Cha…」；标题可 flexShrink，所以它从不造成溢出，只造成难看）。
 */
export const CHAT_FILTER_TITLE_MIN_WIDTH_DP = 52;
/**
 * 与 segment 无关的固定件宽（实测）：列内衬 16×2 + 槽位三个 gap 8×3 + 搜索/＋ 32×2。
 * 胶囊和 segment 组各自由 onLayout 实测，所以这条算术对任何 locale/计数都成立。
 */
export const CHAT_FILTER_SEGMENT_CHROME_DP = 32 + 24 + 64;

/** 实测列宽 → 档位上限（纯函数；三档断言在 chats-header.test.ts）。 */
export function chatFilterSegmentTierForWidthDp(widthDp: number): ChatFilterSegmentTier {
  if (widthDp >= CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP) return "full";
  if (widthDp >= CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP) return "short";
  return "icon";
}

const TIER_ORDER: readonly ChatFilterSegmentTier[] = ["icon", "short", "full"];

/** 降一档；图标档是底线（再降没有可降的形态）。 */
export function downgradeChatFilterSegmentTier(tier: ChatFilterSegmentTier): ChatFilterSegmentTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[i > 0 ? i - 1 : 0];
}

/** 两档取低（列宽上限与拟合上限的交）。 */
export function lowerChatFilterSegmentTier(
  a: ChatFilterSegmentTier,
  b: ChatFilterSegmentTier,
): ChatFilterSegmentTier {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b;
}

/**
 * R4-05: 这一档在实测列宽里装得下吗？槽位内容（胶囊 + segment 组 + 两个图标钮 +
 * gap + 列内衬）超过列宽时，Yoga 压不动它们（segment/图标全 flexShrink:0，胶囊
 * 在非图标档被 B4-F2 钉住固有宽），溢出直接把 ＋ 推出列边界——所以「装得下」必须
 * 由实测宽判定，不能按某一种字形的预算写死。
 */
export function chatFilterSegmentFitsTier(input: {
  columnWidthDp: number;
  pillWidthDp: number;
  segmentGroupWidthDp: number;
}): boolean {
  return (
    input.columnWidthDp -
      CHAT_FILTER_SEGMENT_CHROME_DP -
      input.pillWidthDp -
      input.segmentGroupWidthDp >=
    0
  );
}

/** 全称档之外恒无标题；全称档里装得下 `CHAT_FILTER_TITLE_MIN_WIDTH_DP` 才显示。 */
export function chatFilterTitleFits(input: {
  columnWidthDp: number;
  pillWidthDp: number;
  segmentGroupWidthDp: number;
}): boolean {
  return (
    input.columnWidthDp -
      CHAT_FILTER_SEGMENT_CHROME_DP -
      input.pillWidthDp -
      input.segmentGroupWidthDp >=
    CHAT_FILTER_TITLE_MIN_WIDTH_DP
  );
}

function pillDotStyleFor(total: number, online: number) {
  if (total === 0) return styles.dotIdle;
  if (online === total) return styles.dotOnline;
  if (online === 0) return styles.dotOffline;
  return styles.dotPartial;
}

// One row of the host-status popover: live dot + name + status; online hosts are inert,
// anything else retries that single host.
function HostMenuItem({
  host,
  status,
  onRetry,
}: {
  host: HostProfile;
  status: HostRuntimeConnectionStatus;
  onRetry: (serverId: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const leading = useMemo(() => <HostStatusDot serverId={host.serverId} />, [host.serverId]);
  const handleSelect = useCallback(() => onRetry(host.serverId), [onRetry, host.serverId]);
  return (
    <DropdownMenuItem
      testID={`shell-host-menu-item-${host.serverId}`}
      leading={leading}
      description={t(HOST_STATUS_LABEL_KEY[status])}
      disabled={status === "online"}
      onSelect={handleSelect}
    >
      {host.label}
    </DropdownMenuItem>
  );
}

// One side of the 进行中/已归档 segment. The archived side carries the count so the
// hidden pile stays visible while it is hidden — in ALL THREE tiers (Q2: 计数三档都
// 保留): full/short bake it into the label, icon rides it next to the glyph.
// `label` is the tier-independent full text (a11y); `displayLabel` is what the full/
// short tiers paint. Icons: 进行中=Play（运行语义）、归档=Archive 箱形（裁定 Q2③）。
function FilterSegment({
  kind,
  tier,
  label,
  displayLabel,
  count,
  selected,
  onPress,
  testID,
}: {
  kind: "active" | "archived";
  tier: ChatFilterSegmentTier;
  label: string;
  displayLabel: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const segmentStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.segment,
      // R4-05: 窄两档收横向内边距（12→8）——en 短称在 300dp lg 列就差这 16dp。
      tier !== "full" && styles.segmentNarrow,
      // R4-11: 图标档 active 侧只有一个 14dp 字形，实测触达 38×45.6 < 44 宽；
      // minWidth 把它抬到 44（图标档整组实测 79.6→85.6，260dp md 列仍余 26dp）。
      tier === "icon" && styles.segmentIconTier,
      selected && styles.segmentSelected,
      pressed && !selected && styles.segmentPressed,
    ],
    [selected, tier],
  );
  const iconColor = selected ? styles.segmentIconSelected.color : styles.segmentIcon.color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      hitSlop={SEGMENT_HIT_SLOP}
      testID={testID}
      style={segmentStyle}
    >
      {tier === "icon" ? (
        <>
          {kind === "active" ? <Play size={14} color={iconColor} /> : null}
          {kind === "archived" ? <Archive size={14} color={iconColor} /> : null}
          {kind === "archived" && count != null && count > 0 ? (
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {count}
            </Text>
          ) : null}
        </>
      ) : (
        <Text
          style={[styles.segmentText, selected && styles.segmentTextSelected]}
          numberOfLines={1}
        >
          {displayLabel}
        </Text>
      )}
    </Pressable>
  );
}

// C12: 44dp targets — inside the single bar row (B4 复核): segment 内容高 ≈26 +
// hitSlop(10+10) ≥ 44；胶囊 ≈30 + hitSlop(8+8) ≥ 44；图标钮 32 + slop 8 ≥ 44。
const SEGMENT_HIT_SLOP = { top: 10, bottom: 10 } as const;
const PILL_HIT_SLOP = { top: 8, bottom: 8 } as const;
export type ChatListFilter = "active" | "archived";

/**
 * onLayout → 实测 dp 宽。0.5dp 死区：同宽回写不重渲染——segment 换档会再触发一次
 * layout，死区就是那儿的防回环环。
 */
function useMeasuredWidthDp(): [number | null, (event: LayoutChangeEvent) => void] {
  const [widthDp, setWidthDp] = useState<number | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setWidthDp((prev) => (prev != null && Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);
  return [widthDp, onLayout];
}

/**
 * R4-05: 档位与标题的最终裁决。列宽由调用方实测（那是防回环的那一环），胶囊与
 * segment 组的固有宽通过本钩子返回的两个 handler 进来——两处都 flexShrink:0，量到
 * 即固有宽，于是「装不装得下」是实测算术，不再按某一种字形的 dp 预算写死。
 *
 * 降档只在「同列宽 + 同文案」内单调（只降不升），避免降完又升回去打乒乓；列宽或
 * 文案/计数一变，就重新从断点档试一次，实测会再把它压回去。
 */
function useFittedSegmentTier(input: {
  columnWidthDp: number;
  pillLabel: string;
  archivedLabel: string;
  archivedShortLabel: string;
  activeShortLabel: string;
}): {
  tier: ChatFilterSegmentTier;
  showTitle: boolean;
  handlePillLayout: (event: LayoutChangeEvent) => void;
  handleSegmentGroupLayout: (event: LayoutChangeEvent) => void;
} {
  const { columnWidthDp, pillLabel, archivedLabel, archivedShortLabel, activeShortLabel } = input;
  const [pillWidthDp, handlePillLayout] = useMeasuredWidthDp();
  const [segmentGroupWidthDp, handleSegmentGroupLayout] = useMeasuredWidthDp();
  const [fitCap, setFitCap] = useState<{
    key: string;
    widthDp: number;
    cap: ChatFilterSegmentTier;
  } | null>(null);
  const fitKey = `${pillLabel}|${archivedLabel}|${archivedShortLabel}|${activeShortLabel}`;
  const seedTier = chatFilterSegmentTierForWidthDp(columnWidthDp);
  const tier =
    fitCap && fitCap.key === fitKey && Math.abs(fitCap.widthDp - columnWidthDp) < 0.5
      ? lowerChatFilterSegmentTier(seedTier, fitCap.cap)
      : seedTier;
  // 标题让位纪律：short/icon 档从不显示标题（tab 身份在导航轨上，不双写）；full 档
  // 也只有实测还剩 `CHAT_FILTER_TITLE_MIN_WIDTH_DP` 才显示——380-405dp 电话的 en
  // 全称档只剩 36dp，截成「Cha…」比无标题更坏。
  const showTitle =
    tier === "full" &&
    (pillWidthDp == null ||
      segmentGroupWidthDp == null ||
      chatFilterTitleFits({ columnWidthDp, pillWidthDp, segmentGroupWidthDp }));

  useEffect(() => {
    if (pillWidthDp == null || segmentGroupWidthDp == null || tier === "icon") return;
    if (chatFilterSegmentFitsTier({ columnWidthDp, pillWidthDp, segmentGroupWidthDp })) return;
    setFitCap({ key: fitKey, widthDp: columnWidthDp, cap: downgradeChatFilterSegmentTier(tier) });
  }, [fitKey, columnWidthDp, pillWidthDp, segmentGroupWidthDp, tier]);

  return { tier, showTitle, handlePillLayout, handleSegmentGroupLayout };
}

export function ChatsHeader({
  hosts,
  statuses,
  onRetryHost,
  onNewChat,
  onImportChat,
  onConnectHost,
  onSearch,
  searchActive,
  onQueryChange,
  onSearchClose,
  filter,
  onFilterChange,
  archivedCount,
}: {
  hosts: readonly HostProfile[];
  statuses: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  onRetryHost: (serverId: string) => void;
  onNewChat: () => void;
  onImportChat: () => void;
  /** C12: the empty host sheet gets the same 连接主机 entry the empty list offers. */
  onConnectHost: () => void;
  onSearch: () => void;
  /** C9: true while the bar is morphed into the search input. */
  searchActive: boolean;
  onQueryChange: (query: string) => void;
  onSearchClose: () => void;
  filter: ChatListFilter;
  onFilterChange: (filter: ChatListFilter) => void;
  archivedCount: number;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const total = hosts.length;
  const online = hosts.filter((host) => statuses.get(host.serverId) === "online").length;
  const pillDotStyle = pillDotStyleFor(total, online);
  const newChatLeading = useMemo(
    () => <MessageSquarePlus size={16} color={styles.iconColor.color} />,
    [],
  );
  const importLeading = useMemo(() => <Inbox size={16} color={styles.iconColor.color} />, []);
  const connectLeading = useMemo(() => <Server size={16} color={styles.iconColor.color} />, []);
  const searchStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.iconButton, pressed && styles.iconButtonPressed],
    [],
  );
  const pickActive = useCallback(() => onFilterChange("active"), [onFilterChange]);
  const pickArchived = useCallback(() => onFilterChange("archived"), [onFilterChange]);
  // B4-F1/Q2 降级宽度：onLayout 实测头栏宽（=分栏列宽/紧凑窗口宽）；首帧种子用
  // 窗口形态学现算（紧凑=窗口宽；分栏=§4 列表列常量），避免平板首帧全称溢出。
  const [columnWidthDp, handleHeaderLayout] = useMeasuredWidthDp();
  const { width: windowWidthDp } = useWindowDimensions();
  const seedWidthDp = isCompactWindowWidth(windowWidthDp)
    ? windowWidthDp
    : tabletColumnsForWidth(windowWidthDp).list;
  const archivedLabel =
    archivedCount > 0
      ? t("chats.filter.archivedCount", { count: archivedCount })
      : t("chats.filter.archived");
  const archivedShortLabel =
    archivedCount > 0
      ? t("chats.filter.archivedShortCount", { count: archivedCount })
      : t("chats.filter.archivedShort");
  const activeShortLabel = t("chats.filter.activeShort");
  const pillLabel =
    total === 0 ? t("chats.noHostsShort") : t("chats.hostsOnlineCount", { online, total });
  const segment = useFittedSegmentTier({
    columnWidthDp: columnWidthDp ?? seedWidthDp,
    pillLabel,
    archivedLabel,
    archivedShortLabel,
    activeShortLabel,
  });
  const segmentTier = segment.tier;

  return (
    // 宽度测量壳：列宽变化（旋转/分栏拖动）在这里进状态；header 与列表仍是兄弟，
    // 档位 state 只重渲染头栏，不触列表容器（B4-REGRESS remount 纪律）。
    <View onLayout={handleHeaderLayout}>
      {searchActive ? (
        // KI-12: the search morph rides the same fixed container (title-less full-row
        // slot) — total header height never changes, the list below never jumps.
        <ShellTabHeader>
          <SearchModeBar
            onQueryChange={onQueryChange}
            onCancel={onSearchClose}
            placeholder={t("chats.searchPlaceholder")}
            inputTestID="shell-chat-search-input"
            cancelTestID="shell-chat-search-cancel"
          />
        </ShellTabHeader>
      ) : (
        <ShellTabHeader title={segment.showTitle ? t("chats.title") : ""}>
          <DropdownMenu>
            <DropdownMenuTrigger
              testID="shell-host-pill"
              accessibilityRole="button"
              accessibilityLabel={pillLabel}
              hitSlop={PILL_HIT_SLOP}
              style={[styles.pillTrigger, segmentTier !== "icon" && styles.pillPinned]}
            >
              <View
                style={[
                  styles.pill,
                  styles.pillRow,
                  segmentTier !== "full" && styles.pillRowNarrow,
                ]}
                onLayout={segment.handlePillLayout}
              >
                <View style={[styles.dot, pillDotStyle]} />
                {/* icon 档=裸点终形态（计数进 a11y+菜单；半字形裁切比无字更坏）。 */}
                {segmentTier === "icon" ? null : (
                  <Text style={styles.pillText} numberOfLines={1}>
                    {pillLabel}
                  </Text>
                )}
              </View>
            </DropdownMenuTrigger>
            <DropdownMenuContent width={300}>
              {total === 0 ? (
                <>
                  <DropdownMenuHint>{t("chats.noHosts")}</DropdownMenuHint>
                  <DropdownMenuItem
                    testID="shell-host-sheet-connect"
                    leading={connectLeading}
                    onSelect={onConnectHost}
                  >
                    {t("chats.connectHost")}
                  </DropdownMenuItem>
                </>
              ) : (
                hosts.map((host) => (
                  <HostMenuItem
                    key={host.serverId}
                    host={host}
                    status={statuses.get(host.serverId) ?? "idle"}
                    onRetry={onRetryHost}
                  />
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* B4-F1/F3: 筛选 segment 上移进 bar 行（原 accessory 带已废除）。 */}
          <View
            style={[styles.pill, styles.segmentGroup]}
            testID="shell-chat-filter"
            onLayout={segment.handleSegmentGroupLayout}
          >
            <FilterSegment
              kind="active"
              tier={segmentTier}
              label={t("chats.filter.active")}
              displayLabel={segmentTier === "short" ? activeShortLabel : t("chats.filter.active")}
              selected={filter === "active"}
              onPress={pickActive}
              testID="shell-filter-active"
            />
            <FilterSegment
              kind="archived"
              tier={segmentTier}
              label={archivedLabel}
              displayLabel={segmentTier === "short" ? archivedShortLabel : archivedLabel}
              count={archivedCount}
              selected={filter === "archived"}
              onPress={pickArchived}
              testID="shell-filter-archived"
            />
          </View>
          <Pressable
            onPress={onSearch}
            accessibilityRole="search"
            hitSlop={8}
            testID="shell-chats-search"
            style={searchStyle}
          >
            <Search size={18} color={styles.iconColor.color} />
          </Pressable>
          <DropdownMenu>
            <DropdownMenuTrigger
              testID="shell-plus-menu"
              accessibilityRole="button"
              hitSlop={6}
              style={styles.iconButton}
            >
              <Plus size={18} color={styles.iconColor.color} />
            </DropdownMenuTrigger>
            <DropdownMenuContent width={300}>
              <DropdownMenuItem
                testID="shell-new-chat"
                leading={newChatLeading}
                onSelect={onNewChat}
              >
                {t("chats.newChat")}
              </DropdownMenuItem>
              <DropdownMenuItem
                testID="shell-import-chat"
                leading={importLeading}
                onSelect={onImportChat}
              >
                {t("chats.importChat")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ShellTabHeader>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pillTrigger: {
    borderRadius: theme.borderRadius.full,
    // KI-12/C32: the pill is the right slot's shrink victim — the count label
    // ellipsizes (→ dot) before the search/＋ icons give up a pixel.
    flexShrink: 1,
  },
  // B4-F2 计数可见性：full/short 档胶囊钉住固有宽（「● 1/2」不许被压成裸点，
  // 缺口由标题让位吃）；icon 档回到收缩姿势（点=最后形态）。
  pillPinned: {
    flexShrink: 0,
  },
  pill: {
    flexDirection: "row",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    // Shrink with the trigger (Yoga children default to flexShrink:0).
    flexShrink: 1,
  },
  pillRow: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
  },
  // R4-05: 窄两档（short/icon）横向内边距 12→8——en 短称在 300dp lg 列的预算差
  // 就落在这里（胶囊 62.8→54.8，segment 组 134.4→118.4，合计腾出 24dp）。
  pillRowNarrow: {
    paddingHorizontal: theme.spacing[2],
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    // RN Text defaults to flexShrink:0 — allow the ellipsize the row needs.
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  dotOnline: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotPartial: {
    backgroundColor: theme.colors.statusWarning,
  },
  dotOffline: {
    backgroundColor: theme.colors.statusDanger,
  },
  dotIdle: {
    backgroundColor: theme.colors.border,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  iconButtonPressed: {
    backgroundColor: theme.colors.surface1,
  },
  // Static color holder for the lucide glyphs (the schedule-row glyph idiom).
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  // Filter segment: the pill's chrome, split into two thumb-sized halves.
  segmentGroup: {
    padding: theme.spacing[0.5],
    gap: theme.spacing[0.5],
    // 不缩：B4-F1 溢出链=标题让位→胶囊收缩→segment 换档，带内控件不被压出可点
    // 底线。R4-05 复核补：链子前两环在窄列里根本吃不到（胶囊 full/short 档被 B4-F2
    // 钉住、标题 flexShrink 只分到几 dp），所以换档判定改成实测宽
    // （`chatFilterSegmentFitsTier`），不再只信按 zh 字形写的 dp 断点。
    flexShrink: 0,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    flexShrink: 0,
  },
  // R4-05: 窄两档收横向内边距（同 pillRowNarrow，两半合计 16dp）。
  segmentNarrow: {
    paddingHorizontal: theme.spacing[2],
  },
  // R4-11: 图标档 active 侧只有 14dp 字形 → 实测触达 38dp 宽 < 44；minWidth 兜住
  // 拇指位（图标档整组 79.6→85.6，260dp md 列实测仍余 26dp）。
  segmentIconTier: {
    minWidth: 44,
  },
  segmentSelected: {
    backgroundColor: theme.colors.surface2,
  },
  segmentPressed: {
    backgroundColor: theme.colors.surface1,
  },
  segmentText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  segmentTextSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  // icon 档字形配色（与 segmentText 同阶，选中提亮——静态色 holder 姿势）。
  segmentIcon: {
    color: theme.colors.foregroundMuted,
  },
  segmentIconSelected: {
    color: theme.colors.foreground,
  },
}));
