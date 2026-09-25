// 快捷指令动作层 (card C7): the shellAgentActions pattern — React-free, ports
// injected, unit-testable. `run` assembles the createAgent request through
// resolveCommandRunPlan and fires it down the official creation channel
// (DaemonClient.createAgent, the composer draft's own call site), then hands the
// new agent id to the C4 push-navigation helper. `remove` is destructive-gated
// behind the official confirm dialog like the chat menu's 删除. Every outcome
// reports through notify/reportError; failures never surface as silent no-ops.
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import { useSessionStore } from "@/stores/session-store";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { providersSnapshotQueryKey } from "@/data/providers-snapshot";
import { queryClient } from "@/data/query-client";
import { useToast } from "@/contexts/toast-context";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { usePaseoGoCommandsStore, type ShellCommand } from "@/shell/stores/commands";
import type { ShellActionTranslate } from "@/shell/shellAgentActions";
import { resolveCommandRunPlan } from "./run-plan";

/** The daemon surface the runner needs; `Pick` keeps test doubles honest. */
export type ShellCommandClientPort = Pick<DaemonClient, "createAgent">;

export interface ShellCommandActionDeps {
  t: ShellActionTranslate;
  notify: (message: string) => void;
  reportError: (title: string, message: string) => void;
  /** null = host has no live connection → 离线 toast, never a queued request. */
  getClient: (hostId: string) => ShellCommandClientPort | null;
  /** workspaceDirectory from the synced descriptor; null → 尚未同步 toast. */
  getWorkspaceDirectory: (hostId: string, workspaceId: string) => string | null;
  getPreferredProvider: () => string | null;
  getAvailableProviders: (hostId: string) => readonly string[];
  nextClientMessageId: () => string;
  navigateToAgent: (input: { serverId: string; agentId: string; workspaceId: string }) => void;
  confirm?: (input: ConfirmDialogInput) => Promise<boolean>;
  haptic?: () => void;
  /** C12: 运行成功专属反馈（默认 Success 通知触觉，注入保持可测）。 */
  successHaptic?: () => void;
}

export interface ShellCommandActions {
  /** Resolved workspaceId (the picker's answer or the command's own binding). */
  run: (command: ShellCommand, workspaceId: string) => Promise<void>;
  /** Destructive: native confirm, then the local store removal. */
  remove: (command: ShellCommand) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const RUN_ERROR_KEYS = {
  offline: "commands.errors.offline",
  workspaceNotSynced: "commands.errors.workspaceNotSynced",
  noProvider: "commands.errors.noProvider",
} as const;

export function createShellCommandActions(deps: ShellCommandActionDeps): ShellCommandActions {
  const { t, notify, reportError } = deps;
  const confirm = deps.confirm ?? confirmDialog;
  const haptic =
    deps.haptic ??
    ((): void => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    });
  const successHaptic =
    deps.successHaptic ??
    ((): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    });

  return {
    run: async (command, workspaceId) => {
      haptic();
      const client = deps.getClient(command.hostId);
      const plan = resolveCommandRunPlan({
        providerModel: command.providerModel,
        clientAvailable: client !== null,
        workspaceDirectory: deps.getWorkspaceDirectory(command.hostId, workspaceId),
        prompt: command.prompt,
        workspaceId,
        clientMessageId: deps.nextClientMessageId(),
        preferredProvider: deps.getPreferredProvider(),
        availableProviders: deps.getAvailableProviders(command.hostId),
      });
      if (!plan.ok) {
        reportError(t("commands.errors.runFailed"), t(RUN_ERROR_KEYS[plan.error]));
        return;
      }
      // plan.ok ⟺ a client existed at assembly time; this is the race guard.
      if (!client) {
        reportError(t("commands.errors.runFailed"), t(RUN_ERROR_KEYS.offline));
        return;
      }
      try {
        const agent = await client.createAgent(plan.request);
        // C12: 发起 tick 之外补“成功落地”反馈——会话即将切换，触觉是唯一的即时确认。
        successHaptic();
        deps.navigateToAgent({
          serverId: command.hostId,
          agentId: agent.id,
          workspaceId: agent.workspaceId ?? workspaceId,
        });
      } catch (error) {
        reportError(t("commands.errors.runFailed"), errorText(error));
      }
    },
    remove: async (command) => {
      const confirmed = await confirm({
        title: t("commands.menu.deleteConfirmTitle"),
        message: t("commands.menu.deleteConfirmMessage", { name: command.name }),
        confirmLabel: t("commands.menu.deleteConfirm"),
        cancelLabel: t("commands.menu.deleteCancel"),
        destructive: true,
      });
      if (!confirmed) return;
      haptic();
      usePaseoGoCommandsStore.getState().removeCommand(command.id);
      notify(t("commands.toast.deleted", { name: command.name }));
    },
  };
}

// ---------------------------------------------------------------------------
// Screen-side wiring: real ports (host-runtime client, session-store descriptors,
// form preferences, cached providers snapshot) bound to the shell i18n namespace
// and the toast host — the useShellAgentActions pattern.
// ---------------------------------------------------------------------------

function createClientMessageId(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return `cmd-${Date.now()}-${random}`;
}

export function useShellCommandActions(): ShellCommandActions {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const toast = useToast();
  const { preferences } = useFormPreferences();
  const notify = useCallback((message: string) => toast.show(message), [toast]);
  // C12: 错误统一官方 toast.error（与 shellAgentActions 同轨）。
  const reportError = useCallback(
    (title: string, message: string) => toast.error(`${title}: ${message}`),
    [toast],
  );
  const translate = t as ShellActionTranslate;
  const preferredProvider = preferences.provider ?? null;

  return useMemo(
    () =>
      createShellCommandActions({
        t: translate,
        notify,
        reportError,
        getClient: (hostId) => getHostRuntimeStore().getClient(hostId),
        getWorkspaceDirectory: (hostId, workspaceId) =>
          useSessionStore.getState().sessions[hostId]?.workspaces.get(workspaceId)
            ?.workspaceDirectory ?? null,
        getPreferredProvider: () => preferredProvider,
        // Home-scope snapshot cache only — a run must never await a catalog fetch;
        // the list is the fallback floor, form preferences stay the primary default.
        getAvailableProviders: (hostId) => {
          const data = queryClient.getQueryData<{
            entries?: { provider: string; enabled: boolean; status: string }[];
          }>(providersSnapshotQueryKey(hostId, null));
          return (data?.entries ?? [])
            .filter((entry) => entry.enabled && entry.status === "ready")
            .map((entry) => entry.provider);
        },
        nextClientMessageId: createClientMessageId,
        navigateToAgent: shellNavigateToAgent,
      }),
    [translate, notify, reportError, preferredProvider],
  );
}
