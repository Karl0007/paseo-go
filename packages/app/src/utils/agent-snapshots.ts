import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import {
  TURN_LIVENESS_IDLE,
  type ActiveTurnIdentity,
  type TurnLiveness,
} from "@/timeline/turn-liveness";
import type { Agent } from "@/stores/session-store";

function normalizeActiveTurn(
  snapshot: AgentSnapshotPayload,
  lastUserMessageAt: Date | null,
): ActiveTurnIdentity | null {
  if (snapshot.activeTurn === null) return null;
  if (snapshot.activeTurn) {
    return {
      turnId: snapshot.activeTurn.turnId,
      startedAt: snapshot.activeTurn.startedAt ? new Date(snapshot.activeTurn.startedAt) : null,
    };
  }
  return snapshot.status === "running" ? { turnId: null, startedAt: lastUserMessageAt } : null;
}

function normalizeTurn(
  snapshot: AgentSnapshotPayload,
  lastUserMessageAt: Date | null,
): TurnLiveness {
  const activeTurn = normalizeActiveTurn(snapshot, lastUserMessageAt);
  return activeTurn
    ? { phase: "open", ...activeTurn, cancellationRequestId: null }
    : TURN_LIVENESS_IDLE;
}

function projectActiveTurn(agent: Agent): Pick<AgentSnapshotPayload, "activeTurn"> {
  if (agent.turn.phase === "idle") return { activeTurn: null };
  if (agent.turn.turnId === null) return {};
  return {
    activeTurn: {
      turnId: agent.turn.turnId,
      startedAt: agent.turn.startedAt?.toISOString() ?? null,
    },
  };
}

export function derivePendingPermissionKey(
  agentId: string,
  request: AgentPermissionRequest,
): string {
  const fallbackId =
    request.id ||
    (typeof request.metadata?.id === "string" ? request.metadata.id : undefined) ||
    request.name ||
    request.title ||
    `${request.kind}:${JSON.stringify(request.input ?? request.metadata ?? {})}`;

  return `${agentId}:${fallbackId}`;
}

export function projectAgentSnapshot(agent: Agent): AgentSnapshotPayload {
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
    model: agent.model,
    ...(agent.features ? { features: agent.features } : {}),
    thinkingOptionId: agent.thinkingOptionId ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    lastUserMessageAt: agent.lastUserMessageAt?.toISOString() ?? null,
    status: agent.status,
    ...projectActiveTurn(agent),
    capabilities: agent.capabilities,
    currentModeId: agent.currentModeId,
    availableModes: agent.availableModes,
    pendingPermissions: agent.pendingPermissions,
    persistence: agent.persistence,
    ...(agent.runtimeInfo ? { runtimeInfo: agent.runtimeInfo } : {}),
    ...(agent.lastUsage ? { lastUsage: agent.lastUsage } : {}),
    ...(agent.lastError ? { lastError: agent.lastError } : {}),
    title: agent.title,
    labels: agent.labels,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    attentionTimestamp: agent.attentionTimestamp?.toISOString() ?? null,
    archivedAt: agent.archivedAt?.toISOString() ?? null,
  };
}

export function normalizeAgentSnapshot(snapshot: AgentSnapshotPayload, serverId: string) {
  const createdAt = new Date(snapshot.createdAt);
  const updatedAt = new Date(snapshot.updatedAt);
  const lastUserMessageAt = snapshot.lastUserMessageAt
    ? new Date(snapshot.lastUserMessageAt)
    : null;
  const attentionTimestamp = snapshot.attentionTimestamp
    ? new Date(snapshot.attentionTimestamp)
    : null;
  const archivedAt = snapshot.archivedAt ? new Date(snapshot.archivedAt) : null;
  const parentAgentId = getParentAgentIdFromLabels(snapshot.labels);
  // COMPAT(agentTurnIdentity): added in v0.2.6, remove after 2027-01-31 once daemon floor >= v0.2.6.
  // Old daemons expose only status. Normalize that legacy signal once so the rest
  // of the app consumes one activity shape.
  const turn = normalizeTurn(snapshot, lastUserMessageAt);

  return {
    serverId,
    id: snapshot.id,
    provider: snapshot.provider,
    status: snapshot.status,
    turn,
    createdAt,
    updatedAt,
    lastUserMessageAt,
    lastActivityAt: updatedAt,
    capabilities: snapshot.capabilities,
    currentModeId: snapshot.currentModeId,
    availableModes: snapshot.availableModes ?? [],
    pendingPermissions: snapshot.pendingPermissions ?? [],
    persistence: snapshot.persistence ?? null,
    runtimeInfo: snapshot.runtimeInfo,
    lastUsage: snapshot.lastUsage,
    lastError: snapshot.lastError ?? null,
    title: snapshot.title ?? null,
    cwd: snapshot.cwd,
    workspaceId: snapshot.workspaceId,
    model: snapshot.model ?? null,
    features: snapshot.features,
    thinkingOptionId: snapshot.thinkingOptionId ?? null,
    requiresAttention: snapshot.requiresAttention ?? false,
    attentionReason: snapshot.attentionReason ?? null,
    attentionTimestamp,
    archivedAt,
    parentAgentId,
    labels: snapshot.labels,
    // COMPAT(agentLastMessagePreview): Paseo Go B4-PREVIEW pure-add; old daemons
    // omit the pair, which normalizes to null = "no preview" (never a crash).
    // Deliberately NOT projected back out by projectAgentSnapshot: the replica
    // cache's strict StoredAgentSnapshotSchema does not carry it, so a cold cache
    // restore shows no preview until the directory re-syncs.
    lastMessagePreview: snapshot.lastMessagePreview ?? null,
    lastMessageRole: snapshot.lastMessageRole ?? null,
    // COMPAT(agentOwnership): Paseo Go B4-OWNERSHIP pure-add; old daemons omit the
    // pair and consumers read that as `none`/`false`. Like the preview pair this is
    // deliberately NOT projected back out by projectAgentSnapshot: the replica
    // cache's strict StoredAgentSnapshotSchema does not carry it, so a cold cache
    // restore shows no badge until the directory re-syncs.
    ownership: snapshot.ownership ?? null,
    externalLooksActive: snapshot.externalLooksActive ?? null,
    // COMPAT(agentOrigin): Paseo Go B6-OWN-HEAL pure-add birth axis; a daemon older
    // than the build omits it and the pill keeps its 未知 state. Same posture as the
    // ownership pair above: NOT projected back out by projectAgentSnapshot.
    origin: snapshot.origin ?? null,
  };
}
