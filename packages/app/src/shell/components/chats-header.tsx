// 对话 tab top bar (KI-12: rendered inside the unified ShellTabHeader — fixed
// height, inset once, outside the list). DESIGN §4: 连接状态胶囊 (tap = per-host
// status popover with single-host retry) sits in the bar's right slot next to
// 搜索/＋; the 进行中/已归档 filter segment (C3: archived rows hide from the live
// list; the filter reveals them and their 取消归档/删除 menu) rides the accessory
// band. 搜索 (C9: the icon opens the header's search mode — the bar row morphs
// into input + 取消, filtering the list below instantly). ＋菜单 (新建对话 = C17
// direct push of the official /new screen (DESIGN §14.7), 导入会话 = C10 push of
// the shell import screen). Menus ride the official menu engine in its
// anchored-popover presentation (C19, DESIGN §14.3): the engine default compact
// mode, anchoring under the trigger and clamping at the right edge.
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Inbox, MessageSquarePlus, Plus, Search, Server } from "lucide-react-native";
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

const HOST_STATUS_LABEL_KEY: Record<HostRuntimeConnectionStatus, string> = {
  idle: "chats.hostStatus.idle",
  connecting: "chats.hostStatus.connecting",
  online: "chats.hostStatus.online",
  offline: "chats.hostStatus.offline",
  error: "chats.hostStatus.error",
};

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
// hidden pile stays visible while it is hidden.
function FilterSegment({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      hitSlop={SEGMENT_HIT_SLOP}
      testID={testID}
      style={segmentStyle}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// C12: 44dp targets for the pill/segment row (module consts — react-perf).
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
  // KI-12 accessory 带：进行中/已归档 segment（react-perf：JSX 进 prop 须 useMemo 稳引用）。
  const filterAccessory = useMemo(
    () => (
      <View style={[styles.pill, styles.segmentGroup]} testID="shell-chat-filter">
        <FilterSegment
          label={t("chats.filter.active")}
          selected={filter === "active"}
          onPress={pickActive}
          testID="shell-filter-active"
        />
        <FilterSegment
          label={
            archivedCount > 0
              ? t("chats.filter.archivedCount", { count: archivedCount })
              : t("chats.filter.archived")
          }
          selected={filter === "archived"}
          onPress={pickArchived}
          testID="shell-filter-archived"
        />
      </View>
    ),
    [t, filter, archivedCount, pickActive, pickArchived],
  );

  if (searchActive) {
    // KI-12: the search morph rides the same fixed container (title-less full-row
    // slot) — total header height never changes, the list below never jumps.
    return (
      <ShellTabHeader>
        <SearchModeBar
          onQueryChange={onQueryChange}
          onCancel={onSearchClose}
          placeholder={t("chats.searchPlaceholder")}
          inputTestID="shell-chat-search-input"
          cancelTestID="shell-chat-search-cancel"
        />
      </ShellTabHeader>
    );
  }
  return (
    <ShellTabHeader title={t("chats.title")} accessory={filterAccessory}>
      <DropdownMenu>
        <DropdownMenuTrigger
          testID="shell-host-pill"
          accessibilityRole="button"
          hitSlop={PILL_HIT_SLOP}
          style={styles.pillTrigger}
        >
          <View style={[styles.pill, styles.pillRow]}>
            <View style={[styles.dot, pillDotStyle]} />
            <Text style={styles.pillText} numberOfLines={1}>
              {total === 0 ? t("chats.noHostsShort") : t("chats.hostsOnline", { online, total })}
            </Text>
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
          <DropdownMenuItem testID="shell-new-chat" leading={newChatLeading} onSelect={onNewChat}>
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
  );
}

const styles = StyleSheet.create((theme) => ({
  pillTrigger: {
    borderRadius: theme.borderRadius.full,
    // KI-12/C32: the pill is the right slot's shrink victim — long 在线 labels
    // ellipsize (→ dot) before the search/＋ icons give up a pixel.
    flexShrink: 1,
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
    // Never shrinks: the 进行中/已归档 labels must stay readable — the status
    // pill absorbs the whole row overflow (C32 wide matrix; inert on compact).
    flexShrink: 0,
  },
  segment: {
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
}));
