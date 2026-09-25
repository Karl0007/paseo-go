// Shell file actions (card C6): the pieces every file surface shares — favorite
// with haptic + toast, copy the absolute path through the official path builder,
// and 添加到对话 through the official draft-store attachment seam. They are exposed
// as target-taking callbacks (one hook instance serves the explorer's per-row menu,
// the selection chip, the preview header, and favorites rows); download/share stay
// on the per-target `useFileDownload` hook (host token + download-store pipeline,
// C6 ruling) — call sites bind their own workspace scope.
import { useCallback } from "react";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { useToast } from "@/contexts/toast-context";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { useSessionStore } from "@/stores/session-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { isFavoritePath, usePaseoGoFavoritesStore } from "@/shell/stores/favorites";
import { OFFICIAL } from "@/shell/routes";

export interface ShellFileTarget {
  hostId: string;
  workspaceId: string;
  workspaceRoot: string;
  /** Workspace-relative path, exactly as the explorer reports it. */
  path: string;
  name: string;
  size?: number;
  mtime?: string;
}

// The chat a file attaches to: the most recently opened chat (C4 read stamp) in the
// file's own workspace — workspace_file attachments resolve against the chat's
// workspace, so a chat elsewhere must not receive the path.
function resolveAttachChat(target: ShellFileTarget): { serverId: string; agentId: string } | null {
  const { lastReadAt } = usePaseoGoReadStateStore.getState();
  const agents = useSessionStore.getState().sessions[target.hostId]?.agents;
  if (!agents) return null;
  let bestAgentId: string | null = null;
  let bestAt = -1;
  for (const [agentId, agent] of agents) {
    if (agent.workspaceId !== target.workspaceId) continue;
    const at = lastReadAt[`${target.hostId}:${agentId}`];
    if (at === undefined || at <= bestAt) continue;
    bestAgentId = agentId;
    bestAt = at;
  }
  return bestAgentId ? { serverId: target.hostId, agentId: bestAgentId } : null;
}

export function useShellFavoriteToggle() {
  const toast = useToast();
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return useCallback(
    (target: ShellFileTarget) => {
      const store = usePaseoGoFavoritesStore.getState();
      if (isFavoritePath(store.items, target.hostId, target.path)) {
        store.removeFavorite(target.hostId, target.path);
        void Haptics.selectionAsync().catch(() => {});
        toast.show(t("favorites.removed", { name: target.name }));
        return;
      }
      store.addFavorite({
        hostId: target.hostId,
        workspaceId: target.workspaceId,
        workspaceRoot: target.workspaceRoot,
        path: target.path,
        name: target.name,
        size: target.size,
        mtime: target.mtime,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.show(t("favorites.added", { name: target.name }));
    },
    [toast, t],
  );
}

export function useShellCopyPath() {
  const toast = useToast();
  return useCallback(
    async (target: ShellFileTarget) => {
      await Clipboard.setStringAsync(
        buildAbsoluteExplorerPath({
          workspaceRoot: target.workspaceRoot,
          entryPath: target.path,
        }),
      );
      toast.copied(target.name);
    },
    [toast],
  );
}

export function useShellAddToChat() {
  const toast = useToast();
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return useCallback(
    async (target: ShellFileTarget) => {
      const chat = resolveAttachChat(target);
      if (!chat) {
        toast.show(t("files.attach.noChat"));
        return;
      }
      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: buildDraftStoreKey(chat),
        attachment: createWorkspaceFileAttachment({ path: target.path }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.show(t("files.attach.added", { name: target.name }));
      router.push(OFFICIAL.agentOpen(chat.serverId, target.workspaceId, chat.agentId) as never);
    },
    [toast, t],
  );
}

export interface ShellFileActions {
  isFavorite: boolean;
  toggleFavorite: () => void;
  copyAbsolutePath: () => Promise<void>;
  addToChat: () => Promise<void>;
}

/** Screen-level binding of the three actions to one fixed target. */
export function useShellFileActions(target: ShellFileTarget): ShellFileActions {
  const items = usePaseoGoFavoritesStore((state) => state.items);
  const toggle = useShellFavoriteToggle();
  const copy = useShellCopyPath();
  const addChat = useShellAddToChat();
  return {
    isFavorite: isFavoritePath(items, target.hostId, target.path),
    toggleFavorite: () => toggle(target),
    copyAbsolutePath: () => copy(target),
    addToChat: () => addChat(target),
  };
}
