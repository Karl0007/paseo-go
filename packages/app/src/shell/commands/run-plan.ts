// 快捷指令执行参数组装 (card C7): the pure half of "tap ⚡ → agents.create". Decides
// whether a run can even be attempted (host client present, workspace descriptor
// synced) and assembles the exact `DaemonClient.createAgent` options — the official
// in-app creation channel (composer/draft/workspace-tab.tsx is the reference call
// site; provider+cwd are hard requirements there, enforced identically here). No
// React, no stores: the action layer feeds it a snapshot of the live state.
import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";

/** `"provider"` / `"provider/model"` → parts; anything without a provider half is null. */
export function splitProviderModel(
  value: string | null | undefined,
): { provider: string; model?: string } | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  const separator = trimmed.indexOf("/");
  if (separator === -1) return { provider: trimmed };
  const provider = trimmed.slice(0, separator).trim();
  const model = trimmed.slice(separator + 1).trim();
  if (provider === "") return null;
  return model === "" ? { provider } : { provider, model };
}

export type CommandRunPlanError = "offline" | "workspaceNotSynced" | "noProvider";

export interface CommandRunPlanInput {
  /** command.providerModel — absent means "resolve the host default". */
  providerModel?: string | null;
  /** The host must have a live client (getHostRuntimeStore().getClient). */
  clientAvailable: boolean;
  /** workspaceDirectory of the resolved workspace, from the synced descriptor. */
  workspaceDirectory: string | null;
  prompt: string;
  workspaceId: string;
  /** Caller-minted (deterministic in tests). */
  clientMessageId: string;
  /** Last provider the composer used (form preferences); the default when unset. */
  preferredProvider: string | null;
  /** Ready+enabled provider ids on the host (providers snapshot, home scope). */
  availableProviders: readonly string[];
}

export interface CommandRunRequest {
  config: AgentSessionConfig;
  workspaceId: string;
  initialPrompt: string;
  clientMessageId: string;
}

export type CommandRunPlan =
  | { ok: true; request: CommandRunRequest }
  | { ok: false; error: CommandRunPlanError };

// Default-model resolution order mirrors the composer's model-sheet fallback
// (`providers.find(selected) ?? providers[0]`): the user's last-used provider wins,
// the host's first ready provider is the floor, nothing ready is a named failure —
// never a silent createAgent that the daemon would reject for a missing provider.
function resolveProviderSelection(
  input: CommandRunPlanInput,
): { provider: string; model?: string } | null {
  const explicit = splitProviderModel(input.providerModel);
  if (explicit) return explicit;
  const preferred = input.preferredProvider?.trim() ?? "";
  if (preferred !== "") return { provider: preferred };
  const first = input.availableProviders[0];
  return first ? { provider: first } : null;
}

export function resolveCommandRunPlan(input: CommandRunPlanInput): CommandRunPlan {
  if (!input.clientAvailable) return { ok: false, error: "offline" };
  if (input.workspaceDirectory === null || input.workspaceDirectory === "") {
    return { ok: false, error: "workspaceNotSynced" };
  }
  const selection = resolveProviderSelection(input);
  if (!selection) return { ok: false, error: "noProvider" };
  return {
    ok: true,
    request: {
      config: {
        provider: selection.provider,
        cwd: input.workspaceDirectory,
        ...(selection.model ? { model: selection.model } : {}),
      },
      workspaceId: input.workspaceId,
      initialPrompt: input.prompt,
      clientMessageId: input.clientMessageId,
    },
  };
}
