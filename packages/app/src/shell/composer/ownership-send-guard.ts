// R4 send guard (B4-OWNERSHIP-UI, batch-4 F8 ruling 14): sending into a session
// that an external terminal may still be writing needs an explicit confirmation.
// The official composer is out of bounds, so the shell wraps the one chokepoint
// every user composer send passes through — the per-host runtime client's
// `sendAgentMessage` (composer/index.tsx builds its send closure on exactly this
// method; queue drains and MCP paths reach it too).
//
// Scope discipline — the guard intercepts ONLY direct composer sends:
// - Direct composer sends always carry `activeTurnBehavior` (interrupt|steer,
//   composer/index.tsx). Background queue drains (host-runtime.
//   drainQueuedAgentMessage) never do — they must never raise a dialog nobody
//   triggered (a cancelled drain would loop: the message stays queued and the
//   next drain asks again).
// - The wrapper is installed only while the shell tab layout is mounted AND
//   shell mode is active at call time, so the official UI stays byte-intact.
// - Cancel = the promise rejects with a plain localized note: the official
//   submit path restores the composer text/attachments and shows the note as its
//   inline send error. Nothing is sent, nothing is lost.
// - Confirm (仍要发送) = the original send runs verbatim — today's behaviour.
//
// The client instance is per-connection: a reconnect hands out a fresh client, so
// installation subscribes to the runtime store and wraps every new instance
// exactly once (module WeakSet — survives hook re-mounts, never double-wraps, so
// the user is never asked twice for one send).
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SHELL_MODE_ENV_DEFAULT } from "@/shell/config";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";
import { OWNERSHIP_SEND_BODY_KEY, decideOwnershipSendWarning } from "@/shell/chats/ownership";

export const OWNERSHIP_SEND_DIALOG_KEYS = {
  title: "chats.ownership.sendTitle",
  confirm: "chats.ownership.sendConfirm",
  cancel: "chats.ownership.sendCancel",
  /** The inline composer note after 取消 (submit path shows error.message). */
  cancelled: "chats.ownership.sendCancelled",
} as const;

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface OwnershipSendGuardDeps {
  t: Translate;
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
}

/** The agent facts the guard reads; a missing agent (directory lost) is `pass`. */
export interface GuardAgentFacts {
  ownership: string | null | undefined;
  externalLooksActive: boolean | null | undefined;
  provider: string;
}

const guardedClients = new WeakSet<object>();

// Live deps: install swaps them (language change re-installs with a fresh `t`).
let activeDeps: OwnershipSendGuardDeps | null = null;

// Shell mode is read at CALL time (not install time): toggling 壳模式 off must go
// byte-intact official even while a wrapped client instance is still alive.
const isShellActiveNow = () =>
  usePaseoGoSettingsStore.getState().shellMode ?? SHELL_MODE_ENV_DEFAULT;

/**
 * One guarded send: confirm when the grading table says warn, pass otherwise.
 * `directSend` is the activeTurnBehavior discriminator (see module header).
 * Exported for the unit tests — the wrapper below is its only runtime caller.
 */
export async function confirmOwnershipSend(
  deps: OwnershipSendGuardDeps,
  facts: GuardAgentFacts | null,
  directSend: boolean,
): Promise<{ proceed: boolean; warned: boolean }> {
  const decision = directSend
    ? decideOwnershipSendWarning({
        ownership: facts?.ownership,
        externalLooksActive: facts?.externalLooksActive,
        provider: facts?.provider ?? "",
      })
    : "pass";
  if (decision === "pass") return { proceed: true, warned: false };
  const ok = await deps.confirm({
    title: deps.t(OWNERSHIP_SEND_DIALOG_KEYS.title),
    message: deps.t(OWNERSHIP_SEND_BODY_KEY[decision]),
    confirmLabel: deps.t(OWNERSHIP_SEND_DIALOG_KEYS.confirm),
    cancelLabel: deps.t(OWNERSHIP_SEND_DIALOG_KEYS.cancel),
  });
  return { proceed: ok, warned: true };
}

/** Look the agent up across every connected host's directory. */
function findAgentFacts(agentId: string): GuardAgentFacts | null {
  for (const session of Object.values(useSessionStore.getState().sessions)) {
    const agent = session?.agents.get(agentId);
    if (agent) {
      return {
        ownership: agent.ownership,
        externalLooksActive: agent.externalLooksActive,
        provider: agent.provider,
      };
    }
  }
  return null;
}

function wrapSendAgentMessage(client: DaemonClient): void {
  if (guardedClients.has(client)) return;
  guardedClients.add(client);
  const original = client.sendAgentMessage.bind(client);
  client.sendAgentMessage = async (agentId, text, options) => {
    const deps = activeDeps;
    if (deps && isShellActiveNow()) {
      const { proceed } = await confirmOwnershipSend(
        deps,
        findAgentFacts(agentId),
        options?.activeTurnBehavior !== undefined,
      );
      // The official submit path catches this, restores the composer text and
      // shows the note inline — the message was never sent.
      if (!proceed) throw new Error(deps.t(OWNERSHIP_SEND_DIALOG_KEYS.cancelled));
    }
    return original(agentId, text, options);
  };
}

/**
 * Wrap every current client and every client the runtime store hands out later.
 * Returns the dispose (unsubscribe) the shell layout's effect cleanup calls;
 * wrapped instances stay wrapped (idempotency lives in the WeakSet).
 */
export function installOwnershipSendGuard(deps: OwnershipSendGuardDeps): () => void {
  activeDeps = deps;
  const store = getHostRuntimeStore();
  const wrapAll = (): void => {
    for (const host of store.getHosts()) {
      const client = store.getClient(host.serverId);
      if (client) wrapSendAgentMessage(client);
    }
  };
  wrapAll();
  const unsubscribe = store.subscribeAll(wrapAll);
  return () => {
    unsubscribe();
    if (activeDeps === deps) activeDeps = null;
  };
}
