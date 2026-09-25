// 工作区 tab 收藏夹文件行 (card C6, DESIGN §5): 名称 · host/项目 · 大小. Tap pushes the
// (detail) preview straight from the stored host/workspace/path snapshot (cross-host
// resolution never waits for the workspace descriptor to sync); long-press opens the
// official-engine menu with 取消收藏/分享/复制路径. Offline hosts render dimmed — the
// preview itself then shows FilePane's disconnected state or the card's failed
// download toast, never a silent no-op.
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { Star } from "lucide-react-native";
import { useFileDownload } from "@/hooks/use-file-download";
import { useSessionStore } from "@/stores/session-store";
import { shellPreviewHref } from "@/shell/routes";
import { formatShellFileSize } from "@/shell/files/format-size";
import {
  useShellCopyPath,
  useShellFavoriteToggle,
  type ShellFileTarget,
} from "@/shell/files/use-shell-file-actions";
import {
  ShellFavoriteRowMenu,
  type ShellFileMenuActions,
} from "@/shell/components/file-action-menu";
import type { ShellFavoriteFile } from "@/shell/stores/favorites";

export function WorkspaceFavoriteRow({
  favorite,
  hostLabel,
  dimmed,
}: {
  favorite: ShellFavoriteFile;
  hostLabel: string;
  dimmed: boolean;
}) {
  const workspace = useSessionStore((state) =>
    state.sessions[favorite.hostId]?.workspaces.get(favorite.workspaceId),
  );
  const target: ShellFileTarget = favorite;
  const toggleFavorite = useShellFavoriteToggle();
  const copyPath = useShellCopyPath();
  const downloadFile = useFileDownload({
    serverId: favorite.hostId,
    workspaceId: favorite.workspaceId,
    workspaceRoot: favorite.workspaceRoot,
  });

  const handleOpen = useCallback(
    () =>
      router.push(
        shellPreviewHref({
          serverId: favorite.hostId,
          workspaceId: favorite.workspaceId,
          path: favorite.path,
          name: favorite.name,
          workspaceRoot: favorite.workspaceRoot,
        }) as Href,
      ),
    [favorite],
  );
  const handleShare = useCallback(() => {
    downloadFile({ fileName: favorite.name, path: favorite.path });
  }, [downloadFile, favorite]);

  const workspaceRootName = favorite.workspaceRoot
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop();
  const projectLabel =
    workspace?.projectCustomName?.trim() ||
    workspace?.projectDisplayName ||
    workspaceRootName ||
    "";
  const subtitle = [
    projectLabel ? `${hostLabel} › ${projectLabel}` : hostLabel,
    favorite.size > 0 ? formatShellFileSize(favorite.size) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const menuActions = useMemo<ShellFileMenuActions>(
    () => ({
      isFavorite: true,
      onToggleFavorite: () => toggleFavorite(target),
      onDownload: handleShare,
      onShare: handleShare,
      onCopyPath: () => {
        void copyPath(target);
      },
    }),
    [toggleFavorite, copyPath, handleShare, target],
  );

  return (
    <ShellFavoriteRowMenu
      title={favorite.name}
      testID={`shell-favorite-row-${favorite.hostId}-${favorite.path}`}
      onPress={handleOpen}
      actions={menuActions}
    >
      <View style={styles.row}>
        <Star size={16} color={styles.starColor.color} fill={styles.starColor.color} />
        <View style={styles.rowText}>
          <Text
            style={[styles.name, dimmed && styles.nameDimmed]}
            numberOfLines={1}
            testID={`shell-favorite-name-${favorite.path}`}
          >
            {favorite.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
    </ShellFavoriteRowMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  starColor: {
    color: theme.colors.accent,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  nameDimmed: {
    color: theme.colors.foregroundMuted,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
