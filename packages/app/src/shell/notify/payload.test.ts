// C11 acceptance: the tap payload must round-trip through the OS bundle AND stay
// invisible to the official router's key reader (serverId/agentId/workspaceId/
// terminalId) — that invisibility is what keeps the official dismissTo family from
// hijacking a shell notification tap.
import { describe, expect, it } from "vitest";
import { decodeAttentionPayload, encodeAttentionPayload, SHELL_NOTIFY_MARKER } from "./payload";

describe("attention payload codec", () => {
  it("round-trips a full target", () => {
    const payload = { serverId: "srv1", agentId: "a1", workspaceId: "ws1" };
    expect(decodeAttentionPayload(encodeAttentionPayload(payload))).toEqual(payload);
  });

  it("round-trips a missing workspace (cold deep-link fallback path)", () => {
    const data = encodeAttentionPayload({ serverId: "srv1", agentId: "a1", workspaceId: null });
    expect(data.wid).toBeUndefined();
    expect(decodeAttentionPayload(data)).toEqual({
      serverId: "srv1",
      agentId: "a1",
      workspaceId: null,
    });
  });

  it("emits no official routing keys", () => {
    const data = encodeAttentionPayload({
      serverId: "srv1",
      agentId: "a1",
      workspaceId: "ws1",
    });
    expect(data.serverId).toBeUndefined();
    expect(data.agentId).toBeUndefined();
    expect(data.workspaceId).toBeUndefined();
    expect(data.terminalId).toBeUndefined();
  });

  it("rejects official push payloads and junk data", () => {
    expect(
      decodeAttentionPayload({ serverId: "srv1", agentId: "a1", workspaceId: "ws1" }),
    ).toBeNull();
    expect(decodeAttentionPayload({ [SHELL_NOTIFY_MARKER]: "9", sid: "s", aid: "a" })).toBeNull();
    expect(decodeAttentionPayload({ [SHELL_NOTIFY_MARKER]: "1", sid: " ", aid: "a" })).toBeNull();
    expect(decodeAttentionPayload({ [SHELL_NOTIFY_MARKER]: "1", sid: "s" })).toBeNull();
    expect(decodeAttentionPayload(undefined)).toBeNull();
    expect(decodeAttentionPayload("pgn")).toBeNull();
  });
});
