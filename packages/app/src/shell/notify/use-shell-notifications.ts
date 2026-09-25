// C11 watcher hook (mounted by (shell)/_layout, so it lives on every shell tab).
// Each aggregated-directory change runs the pure transition planner; new needs_input/
// failed events become local notifications through the service. The ledger, the primed
// flag and the recency floor are module state on purpose: the tabs layout remounts on
// theme switches (AppearanceStyleBoundary) and per-hook refs would reset there,
// re-notifying agents the user was already told about; module state only resets with
// the JS context.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  planAttentionEvents,
  type AttentionAgentSnapshot,
  type AttentionEvent,
  type NotifiedLedger,
} from "./attention";
import { postAttentionNotification, startShellNotifyService } from "./service";

let notified: NotifiedLedger = new Map();
let primed = false;
let lastHostSignature: string | null = null;
let fireFrom = 0;

const ERROR_SUMMARY_MAX = 100;

function summarizeError(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > ERROR_SUMMARY_MAX ? `${flat.slice(0, ERROR_SUMMARY_MAX - 1)}…` : flat;
}

function lastErrorOf(serverId: string, agentId: string): string | null {
  const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
  const raw = agent?.lastError?.trim();
  return raw ? summarizeError(raw) : null;
}

type ShellT = TFunction<typeof SHELL_I18N_NAMESPACE>;

function bodyFor(event: AttentionEvent, t: ShellT): string {
  if (event.kind === "needs_input") return t("notify.needsInputBody");
  const error = lastErrorOf(event.serverId, event.agentId);
  return error ? t("notify.failedBodyWithError", { error }) : t("notify.failedBody");
}

export function useShellNotifications(): void {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const { agents, isLoading } = useAggregatedAgents();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const aliases = usePaseoGoPinsStore((state) => state.aliases);
  const enabled = usePaseoGoSettingsStore((state) => state.notifications);

  useEffect(() => {
    startShellNotifyService(t("notify.channelName"));
  }, [t]);

  useEffect(() => {
    // Baseline discipline: scan only once the host registry is loaded AND every
    // host's directory sync has settled (an empty host list trivially passes
    // isLoading, so the registry gate is load-bearing). A changed host set
    // re-baselines silently: freshly-connected hosts carry old failed agents that
    // are not transitions this user was never told about.
    if (hostRegistryStatus === "loading" || isLoading) return;
    const hostSignature = hosts
      .map((host) => host.serverId)
      .sort()
      .join(",");
    const rebaseline = !primed || hostSignature !== lastHostSignature;
    lastHostSignature = hostSignature;
    // (Re-)baseline resets the recency floor: only transitions stamped after this
    // instant may announce themselves — late-arriving attention patches on OLD
    // agents change the stamp but not the recency, and stay silent.
    if (rebaseline) fireFrom = Date.now();
    const snapshots: AttentionAgentSnapshot[] = agents
      .filter((agent) => !agent.archivedAt)
      .map((agent) => ({
        key: `${agent.serverId}:${agent.id}`,
        serverId: agent.serverId,
        agentId: agent.id,
        workspaceId: agent.workspaceId ?? null,
        bucket: deriveSidebarStateBucket({
          status: agent.status,
          requiresAttention: Boolean(agent.requiresAttention),
          attentionReason: agent.attentionReason ?? null,
          pendingPermissionCount: agent.pendingPermissionCount ?? 0,
        }),
        attentionTimestamp: agent.attentionTimestamp ? agent.attentionTimestamp.getTime() : null,
        lastActivityAt: agent.lastActivityAt.getTime(),
      }));
    const plan = planAttentionEvents({
      enabled,
      primed: !rebaseline,
      fireFrom,
      agents: snapshots,
      notified,
    });
    notified = plan.notified;
    primed = true;
    if (!plan.events.length) return;
    const byKey = new Map<string, (typeof agents)[number]>(
      agents.map((agent) => [`${agent.serverId}:${agent.id}`, agent]),
    );
    for (const event of plan.events) {
      const agent = byKey.get(event.key);
      postAttentionNotification({
        title: aliases[event.key] || agent?.title || t("chats.untitled"),
        body: bodyFor(event, t),
        payload: {
          serverId: event.serverId,
          agentId: event.agentId,
          workspaceId: event.workspaceId,
        },
      });
    }
  }, [agents, isLoading, hosts, hostRegistryStatus, aliases, enabled, t]);
}
