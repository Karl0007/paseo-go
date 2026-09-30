import { describe, expect, it } from "vitest";
import { AgentListItemPayloadSchema, AgentSnapshotPayloadSchema } from "./messages.js";

// B4-PREVIEW (batch-4 F4-Q3=b): the chat-list projection contract. These
// assertions pin what B4-ROW consumes: field names, the role union, and the
// three-state semantics — absent = daemon did not report (old host), null =
// agent has no messages yet, string = newest-message preview.

const CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

function snapshotPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    provider: "codex",
    cwd: "/tmp/project",
    model: null,
    thinkingOptionId: null,
    effectiveThinkingOptionId: null,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    capabilities: CAPABILITIES,
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
    ...overrides,
  };
}

function listItemPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    shortId: "agent-1",
    title: null,
    provider: "codex",
    model: null,
    status: "idle",
    cwd: "/tmp/project",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    lastUserMessageAt: null,
    labels: {},
    ...overrides,
  };
}

describe("agent last-message preview fields (B4-PREVIEW)", () => {
  it("parses snapshots that omit the fields (pre-Paseo-Go daemons)", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(snapshotPayload());
    expect(parsed).not.toHaveProperty("lastMessagePreview");
    expect(parsed).not.toHaveProperty("lastMessageRole");
  });

  it("parses snapshots with null fields (new daemon, no messages yet)", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(
      snapshotPayload({ lastMessagePreview: null, lastMessageRole: null }),
    );
    expect(parsed.lastMessagePreview).toBeNull();
    expect(parsed.lastMessageRole).toBeNull();
  });

  it("parses snapshots with preview values for every role", () => {
    for (const role of ["user", "assistant", "other"] as const) {
      const parsed = AgentSnapshotPayloadSchema.parse(
        snapshotPayload({ lastMessagePreview: "最新一条消息", lastMessageRole: role }),
      );
      expect(parsed.lastMessagePreview).toBe("最新一条消息");
      expect(parsed.lastMessageRole).toBe(role);
    }
  });

  it("rejects roles outside the user/assistant/other union", () => {
    expect(
      AgentSnapshotPayloadSchema.safeParse(
        snapshotPayload({ lastMessagePreview: "x", lastMessageRole: "system" }),
      ).success,
    ).toBe(false);
  });

  it("keeps each field independently nullable and optional", () => {
    expect(
      AgentSnapshotPayloadSchema.safeParse(snapshotPayload({ lastMessagePreview: "only preview" }))
        .success,
    ).toBe(true);
    expect(
      AgentSnapshotPayloadSchema.safeParse(snapshotPayload({ lastMessageRole: "assistant" }))
        .success,
    ).toBe(true);
    expect(
      AgentSnapshotPayloadSchema.safeParse(
        snapshotPayload({ lastMessagePreview: 42, lastMessageRole: null }),
      ).success,
    ).toBe(false);
  });

  it("carries the same fields on MCP list_agents directory entries", () => {
    expect(AgentListItemPayloadSchema.parse(listItemPayload()).lastMessagePreview).toBeUndefined();
    const parsed = AgentListItemPayloadSchema.parse(
      listItemPayload({ lastMessagePreview: "done", lastMessageRole: "assistant" }),
    );
    expect(parsed.lastMessagePreview).toBe("done");
    expect(parsed.lastMessageRole).toBe("assistant");
    expect(
      AgentListItemPayloadSchema.safeParse(
        listItemPayload({ lastMessagePreview: null, lastMessageRole: "robot" }),
      ).success,
    ).toBe(false);
  });
});
