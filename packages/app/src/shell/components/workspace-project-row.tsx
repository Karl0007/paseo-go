// 项目行 (DESIGN §5, card C5): workspace icon | workspace display name + 活跃 agent
// 数角标 | owning-project subtitle. Tapping pushes the shell files route (C6 turns
// it into the real browser). Geometry follows the 对话 row so the two tabs read as
// one product (§9).
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Folder } from "lucide-react-native";
import type { ShellWorkspaceRow } from "@/shell/workspace/derive";

export function WorkspaceProjectRow({
  row,
  dimmed,
  onOpen,
}: {
  row: ShellWorkspaceRow;
  /** Offline-host sections grey their cached rows. */
  dimmed: boolean;
  onOpen: (row: ShellWorkspaceRow) => void;
}) {
  const handleOpen = useCallback(() => onOpen(row), [onOpen, row]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      pressed && styles.rowPressed,
      dimmed && styles.rowDimmed,
    ],
    [dimmed],
  );
  return (
    <Pressable
      onPress={handleOpen}
      accessibilityRole="button"
      style={rowStyle}
      testID={`shell-workspace-row-${row.key}`}
    >
      <View style={styles.iconWrap}>
        <Folder size={18} color={styles.icon.color} />
      </View>
      <View style={styles.textWrap}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>
            {row.name}
          </Text>
          {row.activeCount > 0 ? (
            <View style={styles.badge} testID={`shell-workspace-badge-${row.key}`}>
              <Text style={styles.badgeText}>{row.activeCount}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {row.projectName}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  rowDimmed: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  textWrap: {
    flex: 1,
    gap: theme.spacing[1],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  badge: {
    minWidth: 18,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
