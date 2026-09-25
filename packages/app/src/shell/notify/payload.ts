// C11 notification tap payload codec (DESIGN §8 / card C11). Deliberately NOT the
// official `serverId`/`agentId`/`workspaceId`/`terminalId` keys: the official
// PushNotificationRouter (root _layout) listens to every notification response and
// routes those keys with its own dismissTo verb (SPIKE A2/C4 findings). A payload
// whose keys it cannot read resolves to its harmless `/` fallback, and the tap is
// routed by the shell instead — through the C4 open-intent channel
// (`shellNavigateToAgent`), which is the card's mandated path.
export const SHELL_NOTIFY_MARKER = "pgn";
const SHELL_NOTIFY_MARKER_VALUE = "1";

export interface AttentionPayload {
  serverId: string;
  agentId: string;
  workspaceId: string | null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Flat string-only record — notification `content.data` must survive the OS bundle. */
export function encodeAttentionPayload(payload: AttentionPayload): Record<string, string> {
  const data: Record<string, string> = {
    [SHELL_NOTIFY_MARKER]: SHELL_NOTIFY_MARKER_VALUE,
    sid: payload.serverId,
    aid: payload.agentId,
  };
  if (payload.workspaceId) data.wid = payload.workspaceId;
  return data;
}

/** null for anything that is not a shell attention notification (incl. official pushes). */
export function decodeAttentionPayload(data: unknown): AttentionPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record[SHELL_NOTIFY_MARKER] !== SHELL_NOTIFY_MARKER_VALUE) return null;
  const serverId = nonEmptyString(record.sid);
  const agentId = nonEmptyString(record.aid);
  if (!serverId || !agentId) return null;
  return { serverId, agentId, workspaceId: nonEmptyString(record.wid) };
}
