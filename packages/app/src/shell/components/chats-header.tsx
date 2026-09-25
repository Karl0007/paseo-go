// 对话 tab top bar (DESIGN §4): 连接状态胶囊 (tap = per-host status sheet with
// single-host retry) | 进行中/已归档 filter segment (C3: archived rows hide from the
// live list; the filter reveals them and their 取消归档/删除 menu) | 搜索 icon
// (placeholder until C9) | ＋菜单 (新建对话 = official add-project flow, 导入 =
// placeholder until C10). Menus ride the official menu engine in sheet presentation,
// the compact-native shape the composer already uses.
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Inbox, MessageSquarePlus, Plus, Search } from "lucide-react-native";
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

// One row of the host-status sheet: live dot + name + status; online hosts are inert,
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
      testID={testID}
      style={segmentStyle}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export type ChatListFilter = "active" | "archived";

export function ChatsHeader({
  hosts,
  statuses,
  onRetryHost,
  onNewChat,
  onImportChat,
  onSearch,
  filter,
  onFilterChange,
  archivedCount,
}: {
  hosts: readonly HostProfile[];
  statuses: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  onRetryHost: (serverId: string) => void;
  onNewChat: () => void;
  onImportChat: () => void;
  onSearch: () => void;
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
  const searchStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.iconButton, pressed && styles.iconButtonPressed],
    [],
  );
  const pickActive = useCallback(() => onFilterChange("active"), [onFilterChange]);
  const pickArchived = useCallback(() => onFilterChange("archived"), [onFilterChange]);

  return (
    <View style={styles.header}>
      <Text style={styles.title}>{t("chats.title")}</Text>
      <View style={styles.controlsRow}>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            testID="shell-host-pill"
            accessibilityRole="button"
            style={styles.pillTrigger}
          >
            <View style={[styles.pill, styles.pillRow]}>
              <View style={[styles.dot, pillDotStyle]} />
              <Text style={styles.pillText} numberOfLines={1}>
                {total === 0 ? t("chats.noHostsShort") : t("chats.hostsOnline", { online, total })}
              </Text>
            </View>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={t("chats.hostsMenu")} width={300}>
            {total === 0 ? (
              <DropdownMenuHint>{t("chats.noHosts")}</DropdownMenuHint>
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
        <View style={styles.spacer} />
        <Pressable
          onPress={onSearch}
          accessibilityRole="button"
          hitSlop={8}
          testID="shell-search-placeholder"
          style={searchStyle}
        >
          <Search size={18} color={styles.iconColor.color} />
        </Pressable>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            testID="shell-plus-menu"
            accessibilityRole="button"
            style={styles.iconButton}
          >
            <Plus size={18} color={styles.iconColor.color} />
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={t("chats.newMenu")} width={300}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[3],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  spacer: {
    flex: 1,
  },
  pillTrigger: {
    borderRadius: theme.borderRadius.full,
  },
  pill: {
    flexDirection: "row",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
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
  },
  segment: {
    borderRadius: theme.borderRadius.full,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
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
  },
  segmentTextSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
}));
