// C11 watcher hook (mounted by (shell)/_layout, so it lives on every shell tab).
// Each aggregated-directory change runs the pure transition planner; new needs_input/
// failed events become local notifications through the service. The ledger and the
// primed flag are module state on purpose: the tabs layout remounts on theme switches
// (AppearanceStyleBoundary) and per-hook refs would reset there, re-notifying agents
// the user was already told about; module state only resets with the JS context.
// F5: no device-clock recency floor — the ledger is the only floor (attention.ts).
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { finiteTimeMs } from "@/shell/chats/derive";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  bodyKeyFor,
  planAttentionEvents,
  type AttentionAgentSnapshot,
  type NotifiedLedger,
} from "./attention";
import { postAttentionNotification, startShellNotifyService } from "./service";

let notified: NotifiedLedger = new Map();
let primed = false;
let lastHostSignature: string | null = null;

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
        // R2-14: untrusted host dates → finiteTimeMs; garbage activity reads as
        // epoch (0) and garbage attention as absent, so a NaN stamp can never
        // enter the notified ledger (NaN would defeat dedupe → re-notify storm).
        attentionTimestamp: finiteTimeMs(agent.attentionTimestamp),
        lastActivityAt: finiteTimeMs(agent.lastActivityAt) ?? 0,
      }));
    const plan = planAttentionEvents({
      enabled,
      primed: !rebaseline,
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
        body: t(bodyKeyFor(event)),
        payload: {
          serverId: event.serverId,
          agentId: event.agentId,
          workspaceId: event.workspaceId,
        },
      });
    }
  }, [agents, isLoading, hosts, hostRegistryStatus, aliases, enabled, t]);
}
