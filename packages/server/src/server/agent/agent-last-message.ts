import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

/**
 * COMPAT(agentLastMessagePreview): Paseo Go B4-PREVIEW (batch-4 F4-Q3=b).
 *
 * Single source of truth for the agent-directory `lastMessagePreview` /
 * `lastMessageRole` fields: which timeline items count as a chat message, how
 * their role maps, and how their text becomes a preview. AgentManager maintains
 * the fields incrementally at the `recordTimeline` choke point (live events,
 * submitted prompts, provider-history replays, imports), the register path
 * re-derives them from the timeline tail (restart/resume hydration), and the
 * projections persist them on the stored record.
 *
 * Contiguous assistant items are chunks of one streamed message (same rule as
 * getLastAssistantMessageSegmentFromTimeline), so both the incremental tracker
 * and the tail derivation join them before normalizing — a replayed timeline
 * must project the same preview the live coalescer produced.
 */

/** Wire role union, pinned to the protocol schema so the two cannot drift. */
export type AgentLastMessageRole = NonNullable<AgentSnapshotPayload["lastMessageRole"]>;

export interface AgentLastMessageTrack {
  /** Newest-message preview, normalized; null = no message reported yet. */
  preview: string | null;
  /** Role of the previewed message; null together with preview = no messages. */
  role: AgentLastMessageRole | null;
  /** Timeline seq of the item that produced the preview (run continuation). */
  seq: number | null;
  /** messageId of that item when the provider reported one. */
  messageId: string | null;
}

/** Preview cap in characters (card ruling: 截断 ≤120 去换行). */
export const LAST_MESSAGE_PREVIEW_MAX_CHARS = 120;

export const EMPTY_AGENT_LAST_MESSAGE: AgentLastMessageTrack = {
  preview: null,
  role: null,
  seq: null,
  messageId: null,
};

/**
 * Describe a timeline item as a chat message: role plus raw text, or null when
 * the item is not a message (reasoning, tool calls, todos, compaction, plugin
 * rows never take over the subtitle). `error`/`notification` rows are
 * message-like text the user sees in the transcript, so they surface as `other`.
 */
function describeMessageItem(
  item: AgentTimelineItem,
): { role: AgentLastMessageRole; text: string; messageId: string | null } | null {
  switch (item.type) {
    case "user_message":
      return { role: "user", text: item.text, messageId: item.messageId ?? null };
    case "assistant_message":
      return { role: "assistant", text: item.text, messageId: item.messageId ?? null };
    case "error":
    case "notification":
      return { role: "other", text: item.message, messageId: null };
    default:
      return null;
  }
}

/**
 * Collapse every whitespace run (newlines included) to a single space, trim,
 * and cap at LAST_MESSAGE_PREVIEW_MAX_CHARS. Returns "" for text that is blank
 * after normalization — blank messages do not overwrite an earlier preview.
 */
export function normalizeLastMessagePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= LAST_MESSAGE_PREVIEW_MAX_CHARS) {
    return collapsed;
  }
  return collapsed.slice(0, LAST_MESSAGE_PREVIEW_MAX_CHARS);
}

/** True when appending this item must refresh the directory (push gate). */
export function agentLastMessageTouches(item: AgentTimelineItem): boolean {
  const message = describeMessageItem(item);
  return message !== null && normalizeLastMessagePreview(message.text).length > 0;
}

/**
 * Fold one appended timeline item into the tracker at the recordTimeline choke
 * point. An assistant item that continues the previous item's run (adjacent
 * seq, non-conflicting messageIds) joins its text so streamed chunks project
 * the whole message; anything else starts a fresh run. Returns null when the
 * item must not touch the fields.
 */
export function advanceAgentLastMessage(
  current: AgentLastMessageTrack,
  item: AgentTimelineItem,
  rowSeq: number,
): AgentLastMessageTrack | null {
  const message = describeMessageItem(item);
  if (message === null) {
    return null;
  }
  const preview = normalizeLastMessagePreview(message.text);
  if (preview.length === 0) {
    return null;
  }
  const continuesRun =
    message.role === "assistant" &&
    current.role === "assistant" &&
    current.seq === rowSeq - 1 &&
    !(
      current.messageId !== null &&
      message.messageId !== null &&
      current.messageId !== message.messageId
    );
  return {
    preview: continuesRun
      ? normalizeLastMessagePreview(`${current.preview ?? ""}${message.text}`)
      : preview,
    role: message.role,
    seq: rowSeq,
    messageId: message.messageId,
  };
}

/**
 * Re-derive the tracker from a timeline (scan from the tail so the newest
 * message wins; contiguous assistant chunks are joined into their message;
 * non-message items and blank runs are skipped). Empty timelines yield the
 * empty tracker = "agent has no messages yet".
 */
export function deriveAgentLastMessageFromTimeline(
  items: readonly AgentTimelineItem[],
): AgentLastMessageTrack {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const message = describeMessageItem(items[index]);
    if (message === null) {
      continue;
    }
    let text = message.text;
    if (message.role === "assistant") {
      let headId = message.messageId;
      for (let prior = index - 1; prior >= 0; prior -= 1) {
        const chunk = items[prior];
        if (chunk.type !== "assistant_message") {
          break;
        }
        const chunkId = chunk.messageId ?? null;
        if (chunkId !== null && headId !== null && chunkId !== headId) {
          break;
        }
        text = `${chunk.text}${text}`;
        headId = chunkId ?? headId;
      }
    }
    const preview = normalizeLastMessagePreview(text);
    if (preview.length > 0) {
      return { preview, role: message.role, seq: null, messageId: null };
    }
  }
  return EMPTY_AGENT_LAST_MESSAGE;
}

/** Row-tail variant for durable/imported timeline row seeds. */
export function deriveAgentLastMessageFromRows(
  rows: readonly AgentTimelineRow[],
): AgentLastMessageTrack {
  return deriveAgentLastMessageFromTimeline(rows.map((row) => row.item));
}
