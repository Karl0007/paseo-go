// C11 attention-transition planner (card ruling: 任一 agent 进入 needs_input/failed
// → 通知；同一 agent 同一状态只弹一次). Pure: the shell hook feeds it the aggregated
// directory snapshot and keeps the returned ledger; the vitest suite feeds it fixtures.
//
// Ledger semantics: one record per agent key, holding the last-notified (kind, stamp).
// A record only suppresses the *identical* state — a newer stamp or a needs_input↔failed
// switch is a new transition. Records are never pruned (re-appearing agents must not
// re-notify; the map is bounded by agent count).
//
// Two guards keep old states from shouting: `primed=false` on the first settled scan
// records everything silently, and `fireFrom` (the baseline instant) filters stamps —
// the directory fills in waves (summary rows first, attention fields patched later),
// so an OLD failed agent can change stamp right after the baseline; recency, not
// ledger absence, is what distinguishes a transition the user has not seen yet.
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type AttentionNotifyKind = "needs_input" | "failed";

const NOTIFY_KIND_BY_BUCKET: Record<string, true> = { needs_input: true, failed: true };

export interface AttentionAgentSnapshot {
  /** `${serverId}:${agentId}` — the readState/pins row key. */
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  /** Official bucket, derived by the caller (deriveSidebarStateBucket). */
  bucket: SidebarStateBucket;
  /** Epoch ms of the attention request, when one exists. */
  attentionTimestamp: number | null;
  /** Epoch ms of the last directory event — the stamp fallback. */
  lastActivityAt: number;
}

export interface NotifiedRecord {
  kind: AttentionNotifyKind;
  stamp: number;
}

export type NotifiedLedger = ReadonlyMap<string, NotifiedRecord>;

export interface AttentionEvent {
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  kind: AttentionNotifyKind;
  stamp: number;
}

export interface AttentionScanResult {
  events: AttentionEvent[];
  notified: Map<string, NotifiedRecord>;
}

export function planAttentionEvents(input: {
  /** Shell 通知开关 (settings store). Off = freeze: no events, ledger untouched. */
  enabled: boolean;
  /** False on the very first settled scan of this JS context: record, never fire. */
  primed: boolean;
  /** Transitions stamped before this instant are recorded silently (see header). */
  fireFrom: number;
  agents: readonly AttentionAgentSnapshot[];
  notified: NotifiedLedger;
}): AttentionScanResult {
  if (!input.enabled) return { events: [], notified: new Map(input.notified) };
  const events: AttentionEvent[] = [];
  const notified = new Map(input.notified);
  for (const agent of input.agents) {
    if (!(agent.bucket in NOTIFY_KIND_BY_BUCKET)) continue;
    const kind = agent.bucket as AttentionNotifyKind;
    const stamp = agent.attentionTimestamp ?? agent.lastActivityAt;
    const previous = notified.get(agent.key);
    if (previous && previous.kind === kind && previous.stamp === stamp) continue;
    notified.set(agent.key, { kind, stamp });
    if (!input.primed || stamp < input.fireFrom) continue;
    events.push({
      key: agent.key,
      serverId: agent.serverId,
      agentId: agent.agentId,
      workspaceId: agent.workspaceId,
      kind,
      stamp,
    });
  }
  return { events, notified };
}
