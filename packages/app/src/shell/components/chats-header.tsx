// 对话 tab top bar (KI-12 统一容器 + B4-F1 单行化：60dp 定高、inset 一次、列表外)。
// DESIGN §4: 连接状态胶囊 (tap = per-host status popover with single-host retry) sits
// in the bar's right slot; B4-F2 裁定 2/Q1: the pill label is the bare count
// 「● online/total」(hostsOnlineCount) — the dot carries the global state, the menu
// still shows per-host detail; 无主机态 keeps 「无主机」. The 进行中/已归档 filter
// segment (C3) rode the old accessory band; B4-F1 裁定 1/F3 moved it INTO the bar
// row (标题+胶囊+segment+搜索+＋ 单行). Q2 三档降级: the header measures its own row
// width (onLayout; window-form-factor seed for the first frame) and the segment
// steps 全称 → 短称 → 纯图标 (archived count survives all three tiers — C3's
// 「隐藏堆可见」). 搜索 (C9: the icon morphs the bar into input + 取消, filtering the
// list instantly). ＋菜单 (新建对话 = C17 direct push of the official /new screen
// (DESIGN §14.7), 导入会话 = C10 push of the shell import screen). Menus ride the
// official menu engine in its anchored-popover presentation (C19, DESIGN §14.3):
// the engine default compact mode, anchoring under the trigger and clamping at the
// right edge.
import { useCallback, useMemo, useState } from "react";
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
// B4-F1/Q2: segment 三级降级（按顶栏实测列宽的断点）。
// 设备实据（B4-HEADER 帧轮，MatePad BRT-W09）：宽屏分栏列表列=260 (md)/300 (lg) dp
// （tablet/metrics.ts 常量表 + 真机 uiautomator bounds 对账）；紧凑（手机/竖屏）
// 顶栏=窗口宽 ≥384 量级。断点把三档钉在这三档现实宽度上：
//   width < 280            → icon   （260 md 列：全称/短称都放不下 标题+胶囊+＋）
//   280 ≤ width < 380      → short  （300 lg 列：「活跃/归档 N」+收缩胶囊装得下）
//   width ≥ 380            → full   （紧凑全屏：全称「进行中/已归档 N」）
// ---------------------------------------------------------------------------

export type ChatFilterSegmentTier = "full" | "short" | "icon";
/** 短称档下限（列宽）：低于它 segment 退纯图标。 */
export const CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP = 280;
/** 全称档下限（列宽）：低于它退短称。 */
export const CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP = 380;

/** 实测列宽 → segment 档位（纯函数；三档断言在 chats-header.test.ts）。 */
export function chatFilterSegmentTierForWidthDp(widthDp: number): ChatFilterSegmentTier {
  if (widthDp >= CHAT_FILTER_SEGMENT_FULL_MIN_WIDTH_DP) return "full";
  if (widthDp >= CHAT_FILTER_SEGMENT_SHORT_MIN_WIDTH_DP) return "short";
  return "icon";
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
      selected && styles.segmentSelected,
      pressed && !selected && styles.segmentPressed,
    ],
    [selected],
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
  const [measuredWidthDp, setMeasuredWidthDp] = useState<number | null>(null);
  const { width: windowWidthDp } = useWindowDimensions();
  const seedWidthDp = isCompactWindowWidth(windowWidthDp)
    ? windowWidthDp
    : tabletColumnsForWidth(windowWidthDp).list;
  const segmentTier = chatFilterSegmentTierForWidthDp(measuredWidthDp ?? seedWidthDp);
  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    // 0.5dp 死区：布局回写同宽不重渲染（segment 换档会再触发 layout，防回环）。
    setMeasuredWidthDp((prev) => (prev != null && Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);
  const archivedLabel =
    archivedCount > 0
      ? t("chats.filter.archivedCount", { count: archivedCount })
      : t("chats.filter.archived");
  const archivedShortLabel =
    archivedCount > 0
      ? t("chats.filter.archivedShortCount", { count: archivedCount })
      : t("chats.filter.archivedShort");
  const activeShortLabel = t("chats.filter.activeShort");

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
        // 标题让位纪律（B4-HEADER 实测定案）：short/icon 档整行预算已给
        // 胶囊+segment+图标（300dp 列：32衬+24gap+64胶囊+109短segment+64图标=293），
        // 标题只剩个位数 dp——截断到极限=不可见，直接空串让位（tab 身份在导航轨上，
        // 不双写）。full 档（紧凑全屏）标题恒显。
        <ShellTabHeader title={segmentTier === "full" ? t("chats.title") : ""}>
          <DropdownMenu>
            <DropdownMenuTrigger
              testID="shell-host-pill"
              accessibilityRole="button"
              accessibilityLabel={
                total === 0
                  ? t("chats.noHostsShort")
                  : t("chats.hostsOnlineCount", { online, total })
              }
              hitSlop={PILL_HIT_SLOP}
              style={[styles.pillTrigger, segmentTier !== "icon" && styles.pillPinned]}
            >
              <View style={[styles.pill, styles.pillRow]}>
                <View style={[styles.dot, pillDotStyle]} />
                {/* icon 档=裸点终形态（计数进 a11y+菜单；半字形裁切比无字更坏）。 */}
                {segmentTier === "icon" ? null : (
                  <Text style={styles.pillText} numberOfLines={1}>
                    {total === 0
                      ? t("chats.noHostsShort")
                      : t("chats.hostsOnlineCount", { online, total })}
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
          <View style={[styles.pill, styles.segmentGroup]} testID="shell-chat-filter">
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
    // 不缩：B4-F1 溢出链=标题截断→胶囊收缩→segment 换档（三档降级在
    // chatFilterSegmentTierForWidthDp），带内控件不被压出可点底线。
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
