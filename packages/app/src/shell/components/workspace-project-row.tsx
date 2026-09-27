// L1 工程行 (DESIGN §14.8, card C26): chevron + 工程名 + 聚合活跃角标. The row body
// toggles expand/collapse — 长按 is deliberately absent (the host ⚙ already lives in
// the group header). Geometry follows the 对话 row so the tabs read as one product (§9).
// Also exports the shared L1/L2 count badge: needs_input 优先橙色, plain 活跃 static.
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Folder } from "lucide-react-native";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { badgeTone, type ShellProjectRow, type WorkspaceTreeAgent } from "@/shell/workspace/derive";

/** 活跃计数角标; tone comes from badgeTone (needs=橙, active=运行色静态, 0=不渲染). */
export function WorkspaceTreeBadge({
  activeCount,
  needsInputCount,
  testID,
}: {
  activeCount: number;
  needsInputCount: number;
  testID: string;
}) {
  const tone = badgeTone(activeCount, needsInputCount);
  if (tone === null) return null;
  return (
    <View style={[styles.badge, tone === "needs" && styles.badgeNeeds]} testID={testID}>
      <Text style={styles.badgeText}>{activeCount}</Text>
    </View>
  );
}

export function WorkspaceProjectRow<A extends WorkspaceTreeAgent>({
  row,
  expanded,
  dimmed,
  onToggle,
}: {
  row: ShellProjectRow<A>;
  /** 展开态 lives in the screen (useState, never persisted). */
  expanded: boolean;
  /** Offline-host sections grey their cached rows. */
  dimmed: boolean;
  onToggle: (row: ShellProjectRow<A>) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const handleToggle = useCallback(() => onToggle(row), [onToggle, row]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      pressed && styles.rowPressed,
      dimmed && styles.rowDimmed,
    ],
    [dimmed],
  );
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // C12 无障碍: chevron/badge are purely visual — announce state.
  const labelParts = [
    row.name,
    expanded ? t("workspace.a11yExpanded") : t("workspace.a11yCollapsed"),
  ];
  if (row.activeCount > 0)
    labelParts.push(t("workspace.a11yActiveAgents", { count: row.activeCount }));
  if (dimmed) labelParts.push(t("chats.hostStatus.offline"));
  return (
    <Pressable
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityLabel={labelParts.join(" · ")}
      style={rowStyle}
      testID={`shell-workspace-project-${row.key}`}
    >
      <View style={styles.chevronSlot}>
        <Chevron size={16} color={styles.chevron.color} />
      </View>
      <View style={styles.iconWrap}>
        <Folder size={18} color={styles.icon.color} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {row.name}
        </Text>
      </View>
      <WorkspaceTreeBadge
        activeCount={row.activeCount}
        needsInputCount={row.needsInputCount}
        testID={`shell-workspace-project-badge-${row.key}`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  rowDimmed: {
    opacity: 0.55,
  },
  chevronSlot: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  chevron: {
    color: theme.colors.foregroundExtraMuted,
  },
  iconWrap: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  textWrap: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[1.5],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.statusDotRunning,
  },
  badgeNeeds: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
}));
