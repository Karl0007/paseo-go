// Pure chat-list derivation for the shell 对话 tab (DESIGN.md §4, card C2). No React,
// no RN imports — the screen feeds it live data, the vitest suite feeds it fixtures.
//
// Group order is fixed: 已置顶 → 需要处理(等待批准) → 最近, then one greyed group per
// offline host with cached agents. Rows of offline hosts never join the online groups
// (the offline group is their only home), and the 最近 header hides itself when it is
// the only group on screen.
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

export type ChatSectionKind = "pinned" | "needs_attention" | "recent" | "offline";

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

/** The chat's last event: directory activity, or the attention request if newer. */
export function chatLastEventAt(agent: ChatAgentInput): number {
  return Math.max(agent.lastActivityAt, agent.attentionTimestamp ?? 0);
}

/** Date-field twin of chatLastEventAt for callers holding session-store rows. */
export function chatLastEventAtFromAgent(agent: {
  lastActivityAt: Date;
  attentionTimestamp?: Date | null;
}): number {
  return Math.max(agent.lastActivityAt.getTime(), agent.attentionTimestamp?.getTime() ?? 0);
}

/** Unread = last event newer than the stored read stamp; never-opened counts unread. */
export function isChatUnread(agent: ChatAgentInput, lastReadAt: number | undefined): boolean {
  return chatLastEventAt(agent) > (lastReadAt ?? 0);
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
  const needsAttention: T[] = [];
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
    if (agent.bucket === "needs_input") {
      needsAttention.push(agent);
      continue;
    }
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
  if (needsAttention.length > 0) {
    sections.push({
      kind: "needs_attention",
      serverId: null,
      showHeader: true,
      rows: toRows(
        needsAttention
          .slice()
          .sort(
            (left, right) =>
              (right.attentionTimestamp ?? 0) - (left.attentionTimestamp ?? 0) ||
              byNewestEvent(left, right),
          ),
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
