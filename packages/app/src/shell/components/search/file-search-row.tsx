// 文件名搜索命中行 (card C9, DESIGN §5): 名称 · host · 项目 · 目录. Tapping pushes the
// same (detail) preview the favorites rows and the files screen use — the hit
// carries the full (host, workspace, path) triple so opening never waits on a
// re-browse. Geometry mirrors the 收藏夹 rows so the result list reads as one rail.
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FileText } from "lucide-react-native";
import type { FileSearchHit } from "@/shell/search/file-search";

export function FileSearchRow({
  hit,
  onOpen,
}: {
  hit: FileSearchHit;
  onOpen: (hit: FileSearchHit) => void;
}) {
  const handlePress = useCallback(() => onOpen(hit), [hit, onOpen]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  const subtitle =
    hit.directory === "."
      ? `${hit.hostLabel} · ${hit.workspaceName}`
      : `${hit.hostLabel} · ${hit.workspaceName} · ${hit.directory}`;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      testID={`shell-file-hit:${hit.key}`}
      style={rowStyle}
    >
      <View style={styles.iconWrap}>
        <FileText size={16} color={styles.iconColor.color} />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.name} numberOfLines={1}>
          {hit.name}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
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
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  name: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
