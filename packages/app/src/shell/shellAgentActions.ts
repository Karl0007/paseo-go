// Chat-row actions for the shell (DESIGN §4, card C3): the single source of truth the
// long-press menu, the row's ⋯ button, and later C4/C11 all call into — actions are
// implemented here exactly once.
//
// Pin / rename / archive are shell-local store writes (pins.aliases, archive);
// stop / delete are real daemon operations through the host-runtime client, with
// delete gated behind the official native confirm dialog. Every action fires a
// selection haptic and reports through the injected notify/reportError callbacks,
// so the layer stays React-free and unit-testable against a mock client.
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { useToast } from "@/contexts/toast-context";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { usePaseoGoStickyPreviewStore } from "@/shell/stores/stickyPreview";

/** The row an action targets; `key` is the same `${serverId}:${agentId}` the list uses. */
export interface ShellChatTarget {
  key: string;
  serverId: string;
  agentId: string;
}

/** The daemon surface the action layer needs; `Pick` keeps test doubles honest. */
export type ShellAgentClientPort = Pick<
  DaemonClient,
  "cancelAgent" | "deleteAgent" | "refreshAgent"
>;

export type ShellActionTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface ShellAgentActionDeps {
  t: ShellActionTranslate;
  /** Success feedback channel (the screen wires the app toast host). */
  notify: (message: string) => void;
  /** Failure feedback channel (the screen wires the official error toast, C12). */
  reportError: (title: string, message: string) => void;
  /** Defaults to the live host-runtime client for the target's server. */
  getClient?: (serverId: string) => ShellAgentClientPort | null;
  /** Defaults to the official native confirm dialog. */
  confirm?: (input: ConfirmDialogInput) => Promise<boolean>;
  /** Defaults to a light impact tap; injectable so tests stay deterministic. */
  haptic?: () => void;
}

export interface ShellAgentActions {
  /**
   * KI-11 ruling ④: the ONE pin path. The menu button calls `pin(target)`
   * (append to the 置顶 tail); the drag's cross-zone drop calls the SAME action
   * with the drop slot as `index` (group-relative, clamped). Both land on
   * `pins.togglePin(key, true, index?)` — haptic + toast included, zero forks.
   */
  pin: (target: ShellChatTarget, index?: number) => void;
  unpin: (target: ShellChatTarget) => void;
  /** Shell-local alias; blank input clears it back to the daemon title. */
  rename: (target: ShellChatTarget, alias: string) => void;
  archive: (target: ShellChatTarget) => void;
  unarchive: (target: ShellChatTarget) => void;
  stop: (target: ShellChatTarget) => Promise<void>;
  /** C24 (imported-only row): re-sync the daemon copy from the source session file. */
  refresh: (target: ShellChatTarget) => Promise<void>;
  /** Destructive: native confirm first, daemon delete second, local cleanup third. */
  remove: (target: ShellChatTarget, displayTitle: string) => Promise<void>;
  /** C3 drag-and-drop landing: persists the new 置顶 order with a settle haptic. */
  reorderPinned: (orderedKeys: string[]) => void;
}

// Haptics are fire-and-forget everywhere (the official sidebar idiom): a rejected
// native call must never surface as a failed user action, and awaiting one would
// make the action's own feedback depend on the vibrator.
function tapHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createShellAgentActions(deps: ShellAgentActionDeps): ShellAgentActions {
  const { t, notify, reportError } = deps;
  const getClient =
    deps.getClient ??
    ((serverId: string): ShellAgentClientPort | null => getHostRuntimeStore().getClient(serverId));
  const confirm = deps.confirm ?? confirmDialog;
  const haptic = deps.haptic ?? tapHaptic;
  // C24: 刷新 in-flight gate — a second trigger for the same row while the RPC is
  // still out is a silent no-op (the menu has already closed; a repeat toast or a
  // parallel rehydrate would only race the first).
  const refreshing = new Set<string>();

  const failOffline = (): void => {
    reportError(t("chats.errors.actionFailed"), t("chats.errors.hostOffline"));
  };

  return {
    pin: (target, index) => {
      haptic();
      usePaseoGoPinsStore.getState().togglePin(target.key, true, index);
      notify(t("chats.toast.pinned"));
    },
    unpin: (target) => {
      haptic();
      usePaseoGoPinsStore.getState().togglePin(target.key, false);
      notify(t("chats.toast.unpinned"));
    },
    rename: (target, alias) => {
      const trimmed = alias.trim();
      haptic();
      if (trimmed === "") {
        usePaseoGoPinsStore.getState().setAlias(target.key, null);
        notify(t("chats.toast.aliasCleared"));
        return;
      }
      usePaseoGoPinsStore.getState().setAlias(target.key, trimmed);
      notify(t("chats.toast.renamed"));
    },
    archive: (target) => {
      haptic();
      usePaseoGoArchiveStore.getState().archive(target.key);
      notify(t("chats.toast.archived"));
    },
    unarchive: (target) => {
      haptic();
      usePaseoGoArchiveStore.getState().unarchive(target.key);
      notify(t("chats.toast.unarchived"));
    },
    stop: async (target) => {
      haptic();
      const client = getClient(target.serverId);
      if (!client) {
        failOffline();
        return;
      }
      try {
        await client.cancelAgent(target.agentId);
        notify(t("chats.toast.stopped"));
      } catch (error) {
        reportError(t("chats.errors.actionFailed"), errorText(error));
      }
    },
    refresh: async (target) => {
      if (refreshing.has(target.key)) return;
      haptic();
      const client = getClient(target.serverId);
      if (!client) {
        failOffline();
        return;
      }
      refreshing.add(target.key);
      try {
        await client.refreshAgent(target.agentId);
        notify(t("chats.toast.refreshed"));
      } catch (error) {
        reportError(t("chats.errors.actionFailed"), errorText(error));
      } finally {
        refreshing.delete(target.key);
      }
    },
    remove: async (target, displayTitle) => {
      const confirmed = await confirm({
        title: t("chats.menu.deleteConfirmTitle"),
        message: t("chats.menu.deleteConfirmMessage", { title: displayTitle }),
        confirmLabel: t("chats.menu.deleteConfirm"),
        cancelLabel: t("chats.menu.deleteCancel"),
        destructive: true,
      });
      if (!confirmed) return;
      haptic();
      const client = getClient(target.serverId);
      if (!client) {
        failOffline();
        return;
      }
      try {
        await client.deleteAgent(target.agentId);
      } catch (error) {
        reportError(t("chats.errors.actionFailed"), errorText(error));
        return;
      }
      // The directory entry is gone; its shell-local records must not outlive it.
      const pins = usePaseoGoPinsStore.getState();
      pins.togglePin(target.key, false);
      pins.setAlias(target.key, null);
      usePaseoGoArchiveStore.getState().unarchive(target.key);
      usePaseoGoReadStateStore.getState().clear(target.key);
      usePaseoGoStickyPreviewStore.getState().forget(target.key);
      notify(t("chats.toast.deleted"));
    },
    reorderPinned: (orderedKeys) => {
      haptic();
      usePaseoGoPinsStore.getState().setOrder(orderedKeys);
    },
  };
}

// ---------------------------------------------------------------------------
// Menu matrix (the report's 角色×状态→可见项 contract, and the row's render plan).
// Archived rows carry exactly 取消归档/删除; live rows carry the designed actions,
// with 停止 present-but-disabled unless a turn is actually abortable and 刷新
// appearing only on imported rows (C24).
// ---------------------------------------------------------------------------

export type ChatMenuActionId =
  | "pin"
  | "unpin"
  | "rename"
  | "archive"
  | "unarchive"
  | "stop"
  | "refresh"
  | "delete";

export interface ChatMenuRowState {
  pinned: boolean;
  archived: boolean;
  /** A running or approval-blocked turn: what 停止 can actually cancel. */
  stoppable: boolean;
  /** C24: the row carries `paseo.imported-provider-session` → 刷新 appears. */
  imported: boolean;
}

export interface ChatMenuPlanItem {
  id: ChatMenuActionId;
  enabled: boolean;
}

export function chatMenuPlan(state: ChatMenuRowState): ChatMenuPlanItem[] {
  if (state.archived) {
    return [
      { id: "unarchive", enabled: true },
      { id: "delete", enabled: true },
    ];
  }
  const live: ChatMenuPlanItem[] = [
    { id: state.pinned ? "unpin" : "pin", enabled: true },
    { id: "rename", enabled: true },
    { id: "archive", enabled: true },
    { id: "stop", enabled: state.stoppable },
  ];
  // C24: 刷新 is imported-only (a hidden row, not present-but-disabled — the
  // action is meaningless on a native chat). Archived rows keep the fixed
  // 取消归档/删除 pair (refresh auto-unarchives there; the C3 contract wins).
  if (state.imported) live.push({ id: "refresh", enabled: true });
  live.push({ id: "delete", enabled: true });
  return live;
}

/** Screen-side wiring: the factory bound to the shell i18n namespace and the toast host. */
export function useShellAgentActions(): ShellAgentActions {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const toast = useToast();
  const notify = useCallback((message: string) => toast.show(message), [toast]);
  // C12: 错误反馈统一走官方 toast.error（成功/信息一直是 toast.show）——
  // 同一操作层不再一半 Alert 一半 toast。
  const reportError = useCallback(
    (title: string, message: string) => toast.error(`${title}: ${message}`),
    [toast],
  );
  const translate = t as ShellActionTranslate;
  return useMemo(
    () => createShellAgentActions({ t: translate, notify, reportError }),
    [translate, notify, reportError],
  );
}
