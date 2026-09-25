// 文件浏览屏 shared body (card C16): one browse UI, two root-stack positions.
//   (shell)/files/[serverId]/[workspaceId]   hidden-tab entry (C5 KI-2) — back is an
//       in-tab jump to the 工作区 tab and the Android hardware back is intercepted
//       while focused; that wiring lives in the thin route wrapper, not here.
//   (detail)/files/[serverId]/[workspaceId]  real root-Stack push (capsule entry) —
//       back is a real pop (the wrapper's header back mirrors it); the session
//       screen stays on the stack underneath (C14 measured the hidden-tab route's
//       push to be a navigate-reuse that popped it).
// Everything else is shared: the host › project › workspace breadcrumb header,
// the selection 收藏 chip, the official FileExplorerPane (SPIKE A3 — its
// onOpenFile is fully delegated), the (detail) preview push, and 添加到对话.
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChevronLeft, Star, StarOff, X } from "lucide-react-native";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { useHosts } from "@/runtime/host-runtime";
import {
  useSessionStore,
  type ExplorerEntry,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import {
  buildWorkspaceExplorerStateKey,
  useFileExplorerActions,
} from "@/hooks/use-file-explorer-actions";
import { parentExplorerPath } from "@/utils/explorer-paths";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellPreviewHref } from "@/shell/routes";
import {
  useShellAddToChat,
  useShellFileActions,
  type ShellFileTarget,
} from "@/shell/files/use-shell-file-actions";

// The official rows set selectedEntryPath on press AND long-press; the chip turns
// that selection into the shell's 收藏 affordance for the explorer surface.
function SelectionFavoriteChip({
  serverId,
  workspaceId,
  workspaceRoot,
  entry,
  onClear,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  entry: ExplorerEntry;
  onClear: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const target = useMemo<ShellFileTarget>(
    () => ({
      hostId: serverId,
      workspaceId,
      workspaceRoot,
      path: entry.path,
      name: entry.name,
      size: entry.size,
      mtime: entry.modifiedAt,
    }),
    [serverId, workspaceId, workspaceRoot, entry],
  );
  const { isFavorite, toggleFavorite } = useShellFileActions(target);
  return (
    <View style={styles.chipRow} testID="shell-files-selection-chip">
      <Text style={styles.chipName} numberOfLines={1}>
        {entry.name}
      </Text>
      <Pressable
        onPress={toggleFavorite}
        accessibilityRole="button"
        hitSlop={6}
        style={styles.chipButton}
        testID="shell-files-selection-favorite"
      >
        {isFavorite ? (
          <StarOff size={14} color={styles.chipIcon.color} />
        ) : (
          <Star size={14} color={styles.chipIcon.color} />
        )}
        <Text style={styles.chipLabel}>
          {t(isFavorite ? "files.menu.unfavorite" : "files.menu.favorite")}
        </Text>
      </Pressable>
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        hitSlop={6}
        style={styles.chipButton}
        testID="shell-files-selection-clear"
      >
        <X size={14} color={styles.chipIcon.color} />
      </Pressable>
    </View>
  );
}

// host › project › workspace crumbs over the pane (kept from C5 verbatim, just
// componentized so the screen body stays about browsing).
function FilesHeader({
  hostLabel,
  workspace,
  fallbackName,
  onBack,
  topInset,
}: {
  hostLabel: string;
  workspace: WorkspaceDescriptor | undefined;
  fallbackName: string;
  onBack: () => void;
  topInset: number;
}) {
  const workspaceName = workspace?.title?.trim() || workspace?.name || fallbackName;
  return (
    <View style={[styles.header, { paddingTop: topInset }]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.back}
        testID="shell-files-back"
      >
        <ChevronLeft size={22} color={styles.backIcon.color} />
      </Pressable>
      <View style={styles.crumbs} testID="shell-files-breadcrumbs">
        <Text style={styles.crumbMuted} numberOfLines={1}>
          {hostLabel}
        </Text>
        {workspace ? (
          <>
            <Text style={styles.crumbSep}>›</Text>
            <Text style={styles.crumbMuted} numberOfLines={1}>
              {workspace.projectCustomName?.trim() || workspace.projectDisplayName}
            </Text>
            <Text style={styles.crumbSep}>›</Text>
          </>
        ) : null}
        <Text style={styles.crumbCurrent} numberOfLines={1}>
          {workspaceName}
        </Text>
      </View>
    </View>
  );
}

export function FilesScreenBody({
  serverId,
  workspaceId,
  onBack,
}: {
  serverId: string;
  workspaceId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const hosts = useHosts();
  const workspace = useSessionStore((state) =>
    serverId && workspaceId ? state.sessions[serverId]?.workspaces.get(workspaceId) : undefined,
  );

  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const rootPath = workspace?.workspaceDirectory || workspace?.projectRootPath || "";

  const workspaceStateKey = useMemo(
    () => buildWorkspaceExplorerStateKey({ workspaceId, workspaceRoot: rootPath }),
    [workspaceId, rootPath],
  );
  const explorerState = useSessionStore((state) =>
    serverId && workspaceStateKey
      ? state.sessions[serverId]?.fileExplorer.get(workspaceStateKey)
      : undefined,
  );
  const { selectExplorerEntry } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: rootPath,
  });
  const selectedEntry = useMemo<ExplorerEntry | null>(() => {
    const selectedPath = explorerState?.selectedEntryPath;
    if (!explorerState || !selectedPath) return null;
    const directory = explorerState.directories.get(parentExplorerPath(selectedPath));
    const entry = directory?.entries.find((candidate) => candidate.path === selectedPath);
    return entry?.kind === "file" ? entry : null;
  }, [explorerState]);

  const handleOpenFile = useCallback(
    (path: string) => {
      router.push(
        shellPreviewHref({
          serverId,
          workspaceId,
          path,
          name: path.split(/[/\\]/).pop() ?? path,
          workspaceRoot: rootPath,
        }) as Href,
      );
    },
    [serverId, workspaceId, rootPath],
  );
  const addToChat = useShellAddToChat();
  const handleAddToChat = useCallback(
    (path: string) => {
      void addToChat({
        hostId: serverId,
        workspaceId,
        workspaceRoot: rootPath,
        path,
        name: path.split(/[/\\]/).pop() ?? path,
      });
    },
    [addToChat, serverId, workspaceId, rootPath],
  );
  const handleClearSelection = useCallback(() => selectExplorerEntry(null), [selectExplorerEntry]);

  return (
    <View style={styles.screen}>
      <FilesHeader
        hostLabel={hostLabel}
        workspace={workspace}
        fallbackName={workspaceId}
        onBack={onBack}
        topInset={insets.top + 8}
      />
      {selectedEntry ? (
        <SelectionFavoriteChip
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={rootPath}
          entry={selectedEntry}
          onClear={handleClearSelection}
        />
      ) : null}
      <View style={styles.body}>
        {workspace && serverId ? (
          <FileExplorerPane
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={rootPath}
            onOpenFile={handleOpenFile}
            onAddToChat={handleAddToChat}
          />
        ) : (
          <Text style={styles.missing} testID="shell-files-missing">
            {t("files.notFound")}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  back: {
    padding: theme.spacing[1],
  },
  backIcon: {
    color: theme.colors.foreground,
  },
  crumbs: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  crumbMuted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    maxWidth: "34%",
  },
  crumbSep: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  crumbCurrent: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  chipName: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  chipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  chipIcon: {
    color: theme.colors.foregroundMuted,
  },
  chipLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  body: {
    flex: 1,
  },
  missing: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    paddingTop: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
}));
