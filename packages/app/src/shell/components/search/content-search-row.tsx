// 内容搜索命中行 (card KI-6 Tier 2): preview 主行 + `path · 行号` 副行 — the
// VSCode Ctrl+Shift+F reading. Tapping pushes the same (detail) preview as a
// name hit (path is workspace-relative, "/"-separated, exactly the preview
// contract); line targeting is NOT wired — FilePane takes no line param
// (known_issue in the card report). Geometry mirrors FileSearchRow so the two
// sections read as one rail.
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SearchCode } from "lucide-react-native";
import type { ContentSearchHit } from "@/shell/search/workspace-search";

export function ContentSearchRow({
  hit,
  onOpen,
}: {
  hit: ContentSearchHit;
  onOpen: (hit: ContentSearchHit) => void;
}) {
  const handlePress = useCallback(() => onOpen(hit), [hit, onOpen]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  const subtitle = hit.path === hit.name ? `${hit.line}` : `${hit.path} · ${hit.line}`;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${hit.path}:${hit.line}`}
      testID={`shell-content-hit:${hit.key}`}
      style={rowStyle}
    >
      <View style={styles.iconWrap}>
        <SearchCode size={16} color={styles.iconColor.color} />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.preview} numberOfLines={1}>
          {hit.preview}
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
  preview: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
}));
