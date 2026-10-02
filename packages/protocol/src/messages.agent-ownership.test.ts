import { describe, expect, it } from "vitest";
import { AgentListItemPayloadSchema, AgentSnapshotPayloadSchema } from "./messages.js";

// B4-OWNERSHIP (batch-4 F8): the ownership-axis contract B4-OWNERSHIP-UI consumes.
// Pins the field names, the value union, and the same three-state wire posture as
// lastMessagePreview: absent = daemon predates the field, null = not reported,
// value = the state. `ownership` and `externalLooksActive` are ONE pair —
// "who holds the session" and "in `external`, does the other writer look alive".

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
    provider: "omp",
    cwd: "/tmp/project",
    model: null,
    thinkingOptionId: null,
    effectiveThinkingOptionId: null,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "closed",
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
    provider: "omp",
    model: null,
    status: "closed",
    cwd: "/tmp/project",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    lastUserMessageAt: null,
    labels: {},
    ...overrides,
  };
}

describe("agent ownership fields (B4-OWNERSHIP)", () => {
  it("parses snapshots that omit the fields (pre-Paseo-Go daemons)", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(snapshotPayload());
    expect(parsed).not.toHaveProperty("ownership");
    expect(parsed).not.toHaveProperty("externalLooksActive");
  });

  it("accepts every ownership state with its looksActive companion", () => {
    for (const ownership of ["paseo", "external", "none"] as const) {
      const parsed = AgentSnapshotPayloadSchema.parse(
        snapshotPayload({ ownership, externalLooksActive: ownership === "external" }),
      );
      expect(parsed.ownership).toBe(ownership);
      expect(parsed.externalLooksActive).toBe(ownership === "external");
    }
  });

  it("accepts null (daemon knows the field, reported nothing) distinctly from absent", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(
      snapshotPayload({ ownership: null, externalLooksActive: null }),
    );
    expect(parsed.ownership).toBeNull();
    expect(parsed.externalLooksActive).toBeNull();
  });

  it("rejects an unknown owner and a non-boolean activity flag", () => {
    expect(
      AgentSnapshotPayloadSchema.safeParse(snapshotPayload({ ownership: "native" })).success,
    ).toBe(false);
    expect(
      AgentSnapshotPayloadSchema.safeParse(snapshotPayload({ externalLooksActive: "yes" })).success,
    ).toBe(false);
  });

  it("keeps ownership independent of the last-message pair", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(
      snapshotPayload({
        ownership: "external",
        externalLooksActive: true,
        lastMessagePreview: "continued in terminal",
        lastMessageRole: "assistant",
      }),
    );
    expect(parsed).toMatchObject({
      ownership: "external",
      externalLooksActive: true,
      lastMessagePreview: "continued in terminal",
      lastMessageRole: "assistant",
    });
  });

  it("carries the same pair on the MCP list_agents entry", () => {
    expect(AgentListItemPayloadSchema.parse(listItemPayload())).not.toHaveProperty("ownership");
    const parsed = AgentListItemPayloadSchema.parse(
      listItemPayload({ ownership: "external", externalLooksActive: false }),
    );
    expect(parsed.ownership).toBe("external");
    expect(parsed.externalLooksActive).toBe(false);
  });
});

// B9-SUBACT (F31 ruling B+): the live subagent-count axis the chat row's
// 「子任务×N」 badge reads. Snapshot-only by design — MCP list_agents consumers do
// not need it, and the row reads it off the agent_state payload anyway.
describe("agent activeSubagents field (B9-SUBACT)", () => {
  it("parses snapshots that omit it (pre-B9 daemons) — absent means no badge", () => {
    expect(AgentSnapshotPayloadSchema.parse(snapshotPayload())).not.toHaveProperty(
      "activeSubagents",
    );
  });

  it("accepts a nonnegative integer count, 0 included (the decay-to-zero report)", () => {
    for (const count of [0, 1, 62]) {
      expect(
        AgentSnapshotPayloadSchema.parse(snapshotPayload({ activeSubagents: count }))
          .activeSubagents,
      ).toBe(count);
    }
  });

  it("rejects negative, fractional and non-numeric counts", () => {
    for (const bad of [-1, 1.5, "2"]) {
      expect(
        AgentSnapshotPayloadSchema.safeParse(snapshotPayload({ activeSubagents: bad })).success,
      ).toBe(false);
    }
  });

  it("does not leak onto the MCP list_agents entry", () => {
    // The list schema has no such key: a producer that pastes the snapshot field
    // in gets it STRIPPED, so MCP consumers never see a half-carried axis.
    const parsed = AgentListItemPayloadSchema.parse(
      listItemPayload({ activeSubagents: 3 } as Record<string, unknown>),
    );
    expect(parsed).not.toHaveProperty("activeSubagents");
  });
});
