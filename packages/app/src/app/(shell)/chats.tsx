// Chats tab — C1 skeleton. Probes A1 (multi-host state subscribable in shell screens)
// and A4 (agent status fields suffice for the four-state light); tapping a row proves
// A2 by pushing the official agent route (D2). C2 replaces this with the real list.
import { useCallback } from "react";
import { router, type Href } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useHostRegistryStatus, useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL } from "@/shell/routes";

export default function ShellChatsScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const { agents, isLoading } = useAggregatedAgents();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
    >
      <Text style={styles.title}>{t("chats.title")}</Text>

      <Text style={styles.sectionHeader}>
        {t("chats.hostsHeader")} · {hostRegistryStatus}
      </Text>
      {hosts.length === 0 ? (
        <Text style={styles.muted}>{t("chats.noHosts")}</Text>
      ) : (
        hosts.map((host) => (
          <ShellHostRow key={host.serverId} serverId={host.serverId} label={host.label} />
        ))
      )}

      <ShellAgentList agents={agents} isLoading={isLoading} />
    </ScrollView>
  );
}

// A1: per-host connection state subscribed straight from host-runtime inside a
// (shell) screen — no official-screen intermediary.
function ShellHostRow({ serverId, label }: { serverId: string; label: string }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const snapshot = useHostRuntimeSnapshot(serverId);
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>
        {t("chats.hostLine", { label, status: snapshot?.connectionStatus ?? "idle" })}
      </Text>
    </View>
  );
}

// A4: the four-state light renders from the live payload fields below; A2: the row
// pushes the official agent route from inside the (shell) group.
function ShellAgentList({ agents, isLoading }: { agents: AggregatedAgent[]; isLoading: boolean }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  if (agents.length === 0) {
    return <Text style={styles.muted}>{isLoading ? "…" : t("chats.noAgents")}</Text>;
  }
  return (
    <>
      <Text style={styles.hint}>{t("chats.openAgentHint")}</Text>
      {agents.map((agent) => (
        <ShellAgentRow key={`${agent.serverId}:${agent.id}`} agent={agent} />
      ))}
    </>
  );
}

function ShellAgentRow({ agent }: { agent: AggregatedAgent }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const handlePress = useCallback(() => {
    router.push(OFFICIAL.agent(agent.serverId, agent.id) as Href);
  }, [agent.serverId, agent.id]);
  return (
    <Pressable testID={`shell-agent-row-${agent.id}`} onPress={handlePress} style={styles.row}>
      <AgentStatusDot
        status={agent.status}
        requiresAttention={agent.requiresAttention}
        attentionReason={agent.attentionReason}
        pendingPermissionCount={agent.pendingPermissionCount}
      />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{agent.title ?? agent.id}</Text>
        <Text style={styles.muted}>
          {agent.serverLabel} · {agent.provider}
        </Text>
        <Text style={styles.probeLine}>
          {t("chats.agentStatusLine", {
            status: agent.status,
            turn: agent.turn.phase,
            attention: agent.attentionReason ?? "-",
            pending: agent.pendingPermissionCount ?? 0,
          })}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing[2],
  },
  sectionHeader: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[1],
    textTransform: "uppercase",
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  rowBody: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  probeLine: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundExtraMuted,
  },
  muted: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));
