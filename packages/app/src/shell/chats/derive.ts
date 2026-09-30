// Pure chat-list derivation for the shell 对话 tab (DESIGN.md §4, card C2). No React,
// no RN imports — the screen feeds it live data, the vitest suite feeds it fixtures.
//
// Group order is fixed: 已置顶 → 最近, then one greyed group per offline host with
// cached agents. Rows of offline hosts never join the online groups
// (the offline group is their only home), and the 最近 header hides itself when it is
// the only group on screen.
//
// B4-ROW (batch-4 F4 ruling 1): the 需要处理 queue-jump group is GONE. Waiting-for-
// approval no longer reorders anything — the mark lives inline on the row as the red
// 「[需要回复]」 subtitle prefix, and the list is pure newest-event-first below 置顶.
// The `bucket` field stays on the input: the row still needs it (red prefix, spinner,
// stoppable menu action), only the grouping rule that read it is removed.
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

/** Minimal per-agent facts the derivation needs; the screen widens it with payloads. */
export interface ChatAgentInput {
  /** `${serverId}:${agentId}` — stable row key. */
  key: string;
  serverId: string;
  /** Epoch ms of the last directory event. */
  lastActivityAt: number;
  /** Epoch ms of the attention request, when one exists. */
  attentionTimestamp: number | null;
  /** Official bucket, derived once by the caller (deriveSidebarStateBucket). */
  bucket: SidebarStateBucket;
}

export interface ChatRow<T extends ChatAgentInput = ChatAgentInput> {
  agent: T;
  unread: boolean;
  /** True inside an offline-host group: the row renders greyed out. */
  dimmed: boolean;
}

export type ChatSectionKind = "pinned" | "recent" | "offline";

export interface ChatSection<T extends ChatAgentInput = ChatAgentInput> {
  kind: ChatSectionKind;
  /** Set for `offline` groups; null for the three online groups. */
  serverId: string | null;
  showHeader: boolean;
  rows: ChatRow<T>[];
}

export interface DeriveChatSectionsInput<T extends ChatAgentInput> {
  agents: readonly T[];
  /** Pinned row keys in pin order (pins store). */
  pinnedIds: readonly string[];
  /** Shell-local archived row keys (archive store). */
  archivedIds: readonly string[];
  /** Row key → epoch ms the chat was last opened (readState store). */
  lastReadAt: Readonly<Record<string, number>>;
  /** Host order as registered; offline groups follow it. */
  hostIds: readonly string[];
  hostStatuses: ReadonlyMap<string, HostRuntimeConnectionStatus>;
}

export type ChatListItem<T extends ChatAgentInput = ChatAgentInput> =
  | { type: "section-header"; key: string; section: ChatSection<T> }
  | { type: "row"; key: string; row: ChatRow<T> };

/**
 * R2-14: protocol date fields are bare `z.string()` (wire-compat rule — see
 * parseDateOrNull in @getpaseo/protocol/messages), so a non-compliant host can
 * hand us an Invalid Date whose getTime() is NaN. NaN through Math.max is NaN,
 * and NaN poisons sort comparators, renders "Invalid Date NaN", and fails the
 * readState persist schema (int/nonnegative) — which validated-persist-storage
 * answers by dropping the WHOLE store (R2-13). Shell consumers of untrusted
 * Dates go through this helper; null = "no trustworthy timestamp", never NaN.
 */
export function finiteTimeMs(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The chat's last event: directory activity, or the attention request if newer.
 *  R2-14: non-finite inputs (a caller that skipped finiteTimeMs) read as absent,
 *  so the family's number contract can never carry NaN onward. */
export function chatLastEventAt(agent: ChatAgentInput): number {
  const activity = Number.isFinite(agent.lastActivityAt) ? agent.lastActivityAt : 0;
  const attention = agent.attentionTimestamp ?? 0;
  return Math.max(activity, Number.isFinite(attention) ? attention : 0);
}

/** Date-field twin of chatLastEventAt for callers holding session-store rows.
 *  R2-14: null = every host date is garbage (the caller must skip the write);
 *  one trustworthy date survives a garbage sibling. */
export function chatLastEventAtFromAgent(agent: {
  lastActivityAt: Date;
  attentionTimestamp?: Date | null;
}): number | null {
  const activity = finiteTimeMs(agent.lastActivityAt);
  const attention = finiteTimeMs(agent.attentionTimestamp);
  if (activity === null && attention === null) return null;
  return Math.max(activity ?? 0, attention ?? 0);
}

/** Unread is completion-gated (DESIGN §14.6, C18): only an attention event
 *  (finished / error / awaiting approval) newer than the stored read stamp flags a
 *  chat. Intermediate running activity never does; chats that never completed an
 *  attention-worthy turn — freshly imported, or still mid-run — read as seen. */
export function isChatUnread(agent: ChatAgentInput, lastReadAt: number | undefined): boolean {
  return (agent.attentionTimestamp ?? 0) > (lastReadAt ?? 0);
}

/** C18 双点收敛: the blue dot is reserved for idle rows. Active buckets carry their
 *  state on the status light plus the bold title, and needs_input additionally gets
 *  the count pill — the pill renders on `pendingCount > 0` as a separate judgement,
 *  so the dot steps aside whenever the pill owns the badge slot. */
export function showsUnreadDot(bucket: SidebarStateBucket, pendingCount: number): boolean {
  if (pendingCount > 0) return false;
  return bucket === "done" || bucket === "attention";
}

function byNewestEvent(left: ChatAgentInput, right: ChatAgentInput): number {
  return chatLastEventAt(right) - chatLastEventAt(left);
}

export function deriveChatSections<T extends ChatAgentInput>(
  input: DeriveChatSectionsInput<T>,
): ChatSection<T>[] {
  const { agents, pinnedIds, archivedIds, lastReadAt, hostIds, hostStatuses } = input;
  const archived = new Set(archivedIds);
  const pinnedIndex = new Map<string, number>();
  pinnedIds.forEach((key, index) => {
    if (!pinnedIndex.has(key)) pinnedIndex.set(key, index);
  });

  const pinned: T[] = [];
  const recent: T[] = [];
  const offlineByHost = new Map<string, T[]>();

  for (const agent of agents) {
    if (archived.has(agent.key)) continue;
    if (hostStatuses.get(agent.serverId) !== "online") {
      const bucket = offlineByHost.get(agent.serverId);
      if (bucket) bucket.push(agent);
      else offlineByHost.set(agent.serverId, [agent]);
      continue;
    }
    if (pinnedIndex.has(agent.key)) {
      pinned.push(agent);
      continue;
    }
    // B4-ROW: no bucket branch — a chat waiting for approval sorts by its last
    // event like every other row and carries the red mark inline instead.
    recent.push(agent);
  }

  const toRows = (group: T[], dimmed: boolean): ChatRow<T>[] =>
    group.map((agent) => ({
      agent,
      unread: isChatUnread(agent, lastReadAt[agent.key]),
      dimmed,
    }));

  const sections: ChatSection<T>[] = [];
  if (pinned.length > 0) {
    sections.push({
      kind: "pinned",
      serverId: null,
      showHeader: true,
      rows: toRows(
        pinned
          .slice()
          .sort((left, right) => pinnedIndex.get(left.key)! - pinnedIndex.get(right.key)!),
        false,
      ),
    });
  }
  if (recent.length > 0) {
    sections.push({
      kind: "recent",
      serverId: null,
      // A lone 最近 group says nothing a heading needs to say; it only earns its
      // header when something outranks it above.
      showHeader: sections.length > 0,
      rows: toRows(recent.slice().sort(byNewestEvent), false),
    });
  }

  const hostRank = new Map<string, number>();
  hostIds.forEach((serverId, index) => {
    if (!hostRank.has(serverId)) hostRank.set(serverId, index);
  });
  const offlineHosts = [...offlineByHost.keys()].sort((left, right) => {
    const leftRank = hostRank.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = hostRank.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.localeCompare(right);
  });
  for (const serverId of offlineHosts) {
    sections.push({
      kind: "offline",
      serverId,
      showHeader: true,
      rows: toRows(offlineByHost.get(serverId)!.slice().sort(byNewestEvent), true),
    });
  }

  return sections;
}

/** Stable FlatList key for a section header row. */
export function sectionKey(section: ChatSection): string {
  return section.kind === "offline"
    ? `header:offline:${section.serverId}`
    : `header:${section.kind}`;
}

export function flattenChatSections<T extends ChatAgentInput>(
  sections: readonly ChatSection<T>[],
): ChatListItem<T>[] {
  const items: ChatListItem<T>[] = [];
  for (const section of sections) {
    if (section.showHeader) {
      items.push({ type: "section-header", key: sectionKey(section), section });
    }
    for (const row of section.rows) {
      items.push({ type: "row", key: `row:${row.agent.key}`, row });
    }
  }
  return items;
}
