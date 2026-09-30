import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { AgentManager, type ManagedAgent } from "./agent-manager.js";
import { AgentStorage, parseStoredAgentRecord } from "./agent-storage.js";
import {
  buildStoredAgentPayload,
  toAgentListItemPayload,
  toAgentPayload,
  toStoredAgentRecord,
} from "./agent-projections.js";
import {
  advanceAgentLastMessage,
  agentLastMessageTouches,
  deriveAgentLastMessageFromRows,
  deriveAgentLastMessageFromTimeline,
  EMPTY_AGENT_LAST_MESSAGE,
  LAST_MESSAGE_PREVIEW_MAX_CHARS,
  normalizeLastMessagePreview,
  type AgentLastMessageTrack,
} from "./agent-last-message.js";
import { INITIAL_AGENT_OWNERSHIP } from "./agent-ownership.js";
import { AgentSnapshotPayloadSchema } from "../messages.js";
import type { AgentSession, AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

// B4-PREVIEW (batch-4 F4-Q3=b): the server half of the chat-list contract —
// preview normalization, role mapping, the recordTimeline choke point, the
// stored-record round trip, and the restart/resume re-derivation paths.

const EMPTY_TRACK: AgentLastMessageTrack = EMPTY_AGENT_LAST_MESSAGE;

function toolItem(seq: number): AgentTimelineItem {
  return {
    type: "tool_call",
    callId: `call-${seq}`,
    name: "shell",
    status: "running",
    error: null,
    detail: { type: "unknown", input: { cmd: "echo hi" }, output: null },
  };
}

describe("normalizeLastMessagePreview", () => {
  it("collapses newlines and whitespace runs, then trims", () => {
    expect(normalizeLastMessagePreview("line one\nline   two\r\nthree  ")).toBe(
      "line one line two three",
    );
  });

  it("caps previews at 120 characters keeping the head", () => {
    const long = "x".repeat(LAST_MESSAGE_PREVIEW_MAX_CHARS + 40);
    const capped = normalizeLastMessagePreview(long);
    expect(capped).toHaveLength(LAST_MESSAGE_PREVIEW_MAX_CHARS);
    expect(capped).toBe("x".repeat(LAST_MESSAGE_PREVIEW_MAX_CHARS));
    const exact = "y".repeat(LAST_MESSAGE_PREVIEW_MAX_CHARS);
    expect(normalizeLastMessagePreview(exact)).toBe(exact);
  });

  it("never splits a surrogate pair at the cap (R4-02)", () => {
    // 119 BMP chars + two astral emoji: a code-unit slice at 120 would end on
    // the lone high surrogate of the first emoji and ship `\ud83d` on the wire.
    const capped = normalizeLastMessagePreview(`${"a".repeat(119)}\u{1F600}\u{1F600}`);
    expect(Array.from(capped)).toHaveLength(LAST_MESSAGE_PREVIEW_MAX_CHARS);
    const tail = capped.charCodeAt(capped.length - 1);
    expect(tail >= 0xd800 && tail <= 0xdbff).toBe(false);
    expect(capped).toBe(`${"a".repeat(119)}\u{1F600}`);
  });

  it("reports blank text as an empty preview", () => {
    expect(normalizeLastMessagePreview("  \n\t ")).toBe("");
  });
});

describe("live/replay preview parity (R4-02)", () => {
  const blankRunCases: Array<{ label: string; items: AgentTimelineItem[] }> = [
    {
      label: "same messageId",
      items: [
        { type: "assistant_message", messageId: "m1", text: "Alpha" },
        { type: "assistant_message", messageId: "m1", text: "  \n " },
        { type: "assistant_message", messageId: "m1", text: "beta tail" },
      ],
    },
    {
      label: "no messageIds",
      items: [
        { type: "assistant_message", text: "Alpha" },
        { type: "assistant_message", text: "" },
        { type: "assistant_message", text: "beta tail" },
      ],
    },
  ];

  it.each(blankRunCases)(
    "folds a blank mid-run chunk exactly like replay joins it ($label)",
    ({ items }) => {
      let track = EMPTY_TRACK;
      items.forEach((item, index) => {
        track = advanceAgentLastMessage(track, item, index + 1) ?? track;
      });
      // The subtitle must survive a restart: live fold and replay re-derive
      // agree, and the blank chunk neither truncates the run nor floats it.
      expect(track.preview).toBe(deriveAgentLastMessageFromTimeline(items).preview);
      expect(track.preview).toBe("Alphabeta tail");
    },
  );

  it("keeps a blank chunk with a conflicting id from bridging two messages", () => {
    const items: AgentTimelineItem[] = [
      { type: "assistant_message", messageId: "m1", text: "Alpha" },
      { type: "assistant_message", messageId: "m2", text: "" },
      { type: "assistant_message", messageId: "m2", text: "beta" },
    ];
    let track = EMPTY_TRACK;
    items.forEach((item, index) => {
      track = advanceAgentLastMessage(track, item, index + 1) ?? track;
    });
    expect(track.preview).toBe(deriveAgentLastMessageFromTimeline(items).preview);
    expect(track.preview).toBe("beta");
  });
});

describe("agentLastMessageTouches", () => {
  it("gates directory pushes on message-like items with content", () => {
    expect(agentLastMessageTouches({ type: "user_message", text: "hi" })).toBe(true);
    expect(agentLastMessageTouches({ type: "assistant_message", text: "ok" })).toBe(true);
    expect(agentLastMessageTouches({ type: "error", message: "boom" })).toBe(true);
    expect(agentLastMessageTouches({ type: "notification", level: "info", message: "fyi" })).toBe(
      true,
    );
    expect(agentLastMessageTouches({ type: "reasoning", text: "think" })).toBe(false);
    expect(agentLastMessageTouches(toolItem(1))).toBe(false);
    expect(agentLastMessageTouches({ type: "user_message", text: " \n " })).toBe(false);
  });
});

describe("advanceAgentLastMessage", () => {
  it("starts a run for the first message and ignores non-message items", () => {
    expect(advanceAgentLastMessage(EMPTY_TRACK, { type: "user_message", text: "hi" }, 1)).toEqual({
      preview: "hi",
      role: "user",
      seq: 1,
      messageId: null,
    });
    expect(advanceAgentLastMessage(EMPTY_TRACK, toolItem(1), 1)).toBeNull();
    expect(
      advanceAgentLastMessage(EMPTY_TRACK, { type: "user_message", text: "  " }, 1),
    ).toBeNull();
  });

  it("maps error and notification items to role other", () => {
    const error = advanceAgentLastMessage(EMPTY_TRACK, { type: "error", message: "boom" }, 1);
    expect(error).toMatchObject({ preview: "boom", role: "other" });
    const note = advanceAgentLastMessage(
      EMPTY_TRACK,
      { type: "notification", level: "warning", message: "heads up" },
      2,
    );
    expect(note).toMatchObject({ preview: "heads up", role: "other" });
  });

  it("joins adjacent assistant chunks into one message preview", () => {
    const first = advanceAgentLastMessage(
      EMPTY_TRACK,
      { type: "assistant_message", text: "previe" },
      4,
    )!;
    const joined = advanceAgentLastMessage(first, { type: "assistant_message", text: "w OK" }, 5)!;
    expect(joined).toMatchObject({ preview: "preview OK", role: "assistant", seq: 5 });
  });

  it("keeps same-messageId chunks joined but starts a new run on id conflict", () => {
    const first = advanceAgentLastMessage(
      EMPTY_TRACK,
      { type: "assistant_message", messageId: "m1", text: "A" },
      1,
    )!;
    expect(
      advanceAgentLastMessage(first, { type: "assistant_message", messageId: "m1", text: "B" }, 2),
    ).toMatchObject({ preview: "AB" });
    expect(
      advanceAgentLastMessage(first, { type: "assistant_message", messageId: "m2", text: "B" }, 2),
    ).toMatchObject({ preview: "B", seq: 2 });
  });

  it("never joins across gaps, roles, or non-message items", () => {
    const first = advanceAgentLastMessage(
      EMPTY_TRACK,
      { type: "assistant_message", text: "A" },
      1,
    )!;
    expect(
      advanceAgentLastMessage(first, { type: "assistant_message", text: "B" }, 3),
    ).toMatchObject({ preview: "B" });
    const user = advanceAgentLastMessage(first, { type: "user_message", text: "u" }, 2)!;
    expect(user).toMatchObject({ preview: "u", role: "user" });
    expect(
      advanceAgentLastMessage(user, { type: "assistant_message", text: "C" }, 3),
    ).toMatchObject({ preview: "C" });
  });

  it("caps joined chunk runs at the preview limit", () => {
    let track = advanceAgentLastMessage(
      EMPTY_TRACK,
      { type: "assistant_message", text: "a".repeat(119) },
      1,
    )!;
    track = advanceAgentLastMessage(track, { type: "assistant_message", text: "b".repeat(50) }, 2)!;
    expect(track.preview).toHaveLength(LAST_MESSAGE_PREVIEW_MAX_CHARS);
    expect(track.preview).toBe(`${"a".repeat(119)}${"b".repeat(1)}`);
  });
});

describe("deriveAgentLastMessageFromTimeline", () => {
  it("yields the empty tracker for timelines without messages", () => {
    expect(deriveAgentLastMessageFromTimeline([])).toEqual(EMPTY_AGENT_LAST_MESSAGE);
    expect(deriveAgentLastMessageFromTimeline([toolItem(1)])).toEqual(EMPTY_AGENT_LAST_MESSAGE);
  });

  it("takes the newest message and joins its contiguous assistant chunks", () => {
    expect(
      deriveAgentLastMessageFromTimeline([
        { type: "user_message", text: "first" },
        toolItem(2),
        { type: "assistant_message", text: "pre" },
        { type: "assistant_message", text: "view OK" },
      ]),
    ).toEqual({ preview: "preview OK", role: "assistant", seq: null, messageId: null });
    expect(
      deriveAgentLastMessageFromTimeline([
        { type: "assistant_message", text: "old" },
        { type: "user_message", text: "newest\nquestion" },
      ]),
    ).toMatchObject({ preview: "newest question", role: "user" });
  });

  it("respects messageId conflicts and chunk interruptions", () => {
    expect(
      deriveAgentLastMessageFromTimeline([
        { type: "assistant_message", messageId: "m1", text: "A" },
        { type: "assistant_message", messageId: "m2", text: "B" },
      ]),
    ).toMatchObject({ preview: "B" });
    expect(
      deriveAgentLastMessageFromTimeline([
        { type: "assistant_message", text: "A" },
        { type: "reasoning", text: "hmm" },
        { type: "assistant_message", text: "B" },
      ]),
    ).toMatchObject({ preview: "B" });
  });

  it("skips blank message items when scanning from the tail", () => {
    expect(
      deriveAgentLastMessageFromTimeline([
        { type: "assistant_message", text: "real" },
        { type: "user_message", text: " \n " },
      ]),
    ).toMatchObject({ preview: "real", role: "assistant" });
  });

  it("derives the same tracker from rows", () => {
    const rows: AgentTimelineRow[] = [
      { seq: 1, timestamp: "2026-09-30T00:00:00.000Z", item: { type: "user_message", text: "q" } },
      {
        seq: 2,
        timestamp: "2026-09-30T00:00:01.000Z",
        item: { type: "assistant_message", text: "a1" },
      },
      {
        seq: 3,
        timestamp: "2026-09-30T00:00:02.000Z",
        item: { type: "assistant_message", text: "a2" },
      },
    ];
    expect(deriveAgentLastMessageFromRows(rows)).toMatchObject({
      preview: "a1a2",
      role: "assistant",
    });
  });
});

function createProjectionManagedAgent(
  overrides: Partial<ManagedAgent> & { lastMessage?: Partial<AgentLastMessageTrack> } = {},
): ManagedAgent {
  const now = new Date("2026-09-30T00:00:00.000Z");
  const agent: ManagedAgent = {
    id: "agent-preview-1",
    provider: "claude",
    cwd: "/tmp/project",
    session: {} as AgentSession,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: false,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    config: { provider: "claude", cwd: "/tmp/project" },
    createdAt: now,
    updatedAt: now,
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    persistence: null,
    historyPrimed: true,
    lastUserMessageAt: null,
    lastMessage: {
      ...EMPTY_AGENT_LAST_MESSAGE,
      ...overrides.lastMessage,
    },
    ownership: overrides.ownership ?? INITIAL_AGENT_OWNERSHIP,
    activeTurnId: null,
    activeTurnStartedAt: null,
    foregroundTurnWaiters: new Set(),
    finalizedForegroundTurnIds: new Set(),
    unsubscribeSession: null,
    attention: { requiresAttention: false },
    labels: {},
    lifecycle: "idle",
    activeForegroundTurnId: null,
    ...overrides,
  };
  return agent;
}

describe("projections carry the last-message fields", () => {
  const agent = createProjectionManagedAgent({
    lastMessage: { preview: "done shipping", role: "assistant" },
  });

  it("persists them on the stored record and projects them on the wire", () => {
    const record = toStoredAgentRecord(agent);
    expect(record.lastMessagePreview).toBe("done shipping");
    expect(record.lastMessageRole).toBe("assistant");

    const payload = toAgentPayload(agent);
    expect(payload.lastMessagePreview).toBe("done shipping");
    expect(payload.lastMessageRole).toBe("assistant");
    expect(AgentSnapshotPayloadSchema.safeParse(payload).success).toBe(true);

    expect(toAgentListItemPayload(payload)).toMatchObject({
      lastMessagePreview: "done shipping",
      lastMessageRole: "assistant",
    });
  });

  it("round-trips them through buildStoredAgentPayload", () => {
    const record = toStoredAgentRecord(agent);
    expect(buildStoredAgentPayload(record, ["claude"])).toMatchObject({
      lastMessagePreview: "done shipping",
      lastMessageRole: "assistant",
    });
  });

  it("reads pre-upgrade records without the fields as null (no messages)", () => {
    const {
      lastMessagePreview: _preview,
      lastMessageRole: _role,
      ...legacy
    } = toStoredAgentRecord(agent);
    expect(buildStoredAgentPayload(legacy, ["claude"])).toMatchObject({
      lastMessagePreview: null,
      lastMessageRole: null,
    });
    expect(parseStoredAgentRecord(legacy).lastMessagePreview).toBeUndefined();
    expect(
      toAgentListItemPayload({
        ...toAgentPayload(agent),
        lastMessagePreview: undefined,
        lastMessageRole: undefined,
      }),
    ).toMatchObject({
      lastMessagePreview: null,
      lastMessageRole: null,
    });
  });
});

async function createTurnHarness() {
  const workdir = mkdtempSync(join(tmpdir(), "agent-last-message-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const manager = new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
  const agent = await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  const directoryEvents: string[] = [];
  const unsubscribe = manager.subscribe((event) => {
    directoryEvents.push(event.type);
  });
  directoryEvents.length = 0; // drop the subscribe-time state replay
  return {
    workdir,
    logger,
    storage,
    manager,
    agentId: agent.id,
    directoryEvents,
    unsubscribe,
    live: () => manager.getAgent(agent.id)!.lastMessage,
  };
}

describe("AgentManager last-message maintenance", () => {
  it("follows a live turn, pushes directory updates, and survives a restart", async () => {
    const harness = await createTurnHarness();
    try {
      expect(harness.live()).toMatchObject({ preview: null, role: null });

      await harness.manager.runAgent(harness.agentId, "respond with exactly: preview OK", {
        clientMessageId: "cm-preview-1",
      });

      // The user message landed first, then the streamed assistant chunks —
      // coalesced live into one message.
      expect(harness.live()).toMatchObject({ preview: "preview OK", role: "assistant" });
      expect(harness.directoryEvents).toContain("agent_state");

      await harness.manager.flush();
      const record = await harness.storage.get(harness.agentId);
      expect(record?.lastMessagePreview).toBe("preview OK");
      expect(record?.lastMessageRole).toBe("assistant");

      // Simulated daemon restart: a fresh storage instance over the same
      // directory must serve the fields for the closed agent's directory entry.
      const reopened = new AgentStorage(join(harness.workdir, "agents"), harness.logger);
      await reopened.initialize();
      const reread = await reopened.get(harness.agentId);
      expect(reread?.lastMessagePreview).toBe("preview OK");
      expect(buildStoredAgentPayload(reread!, ["codex"])).toMatchObject({
        lastMessagePreview: "preview OK",
        lastMessageRole: "assistant",
      });
    } finally {
      harness.unsubscribe();
      rmSync(harness.workdir, { recursive: true, force: true });
    }
  });

  it("updates non-stream appends and leaves non-message appends alone", async () => {
    const harness = await createTurnHarness();
    try {
      await harness.manager.appendTimelineItem(harness.agentId, {
        type: "user_message",
        text: "hello\nworld   now",
      });
      expect(harness.live()).toMatchObject({ preview: "hello world now", role: "user" });
      expect(harness.directoryEvents).toContain("agent_state");

      harness.directoryEvents.length = 0;
      await harness.manager.appendTimelineItem(harness.agentId, toolItem(9));
      expect(harness.live()).toMatchObject({ preview: "hello world now", role: "user" });
      expect(harness.directoryEvents).not.toContain("agent_state");

      await harness.manager.appendTimelineItem(harness.agentId, {
        type: "notification",
        level: "info",
        message: "quota refreshed",
      });
      expect(harness.live()).toMatchObject({ preview: "quota refreshed", role: "other" });
    } finally {
      harness.unsubscribe();
      rmSync(harness.workdir, { recursive: true, force: true });
    }
  });

  it("seeds a resume from the record and re-derives on provider-history hydration", async () => {
    const harness = await createTurnHarness();
    let resumed: ManagedAgent | null = null;
    try {
      await harness.manager.runAgent(harness.agentId, "respond with exactly: preview OK", {
        clientMessageId: "cm-preview-2",
      });
      await harness.manager.flush();
      const record = await harness.storage.get(harness.agentId);
      expect(record?.persistence).not.toBeNull();
      // Prove the restore seed really comes from the record, and the hydrated
      // value from the timeline: poison the record first.
      await harness.storage.upsert({
        ...record!,
        lastMessagePreview: "stale seed",
        lastMessageRole: "user",
      });

      const storage2 = new AgentStorage(join(harness.workdir, "agents"), harness.logger);
      const manager2 = new AgentManager({
        clients: createTestAgentClients(),
        registry: storage2,
        logger: harness.logger,
      });
      resumed = await manager2.resumeAgentFromPersistence(
        record!.persistence!,
        undefined,
        harness.agentId,
      );
      expect(resumed.lastMessage).toMatchObject({ preview: "stale seed", role: "user" });

      // The fake provider history stores the streamed chunks uncoalesced; the
      // replay must join them back into the full message preview.
      await manager2.hydrateTimelineFromProvider(harness.agentId, { force: true });
      expect(manager2.getAgent(harness.agentId)!.lastMessage).toMatchObject({
        preview: "preview OK",
        role: "assistant",
      });
      await manager2.flush();
    } finally {
      if (resumed) {
        await resumed.session.close().catch(() => undefined);
      }
      harness.unsubscribe();
      rmSync(harness.workdir, { recursive: true, force: true });
    }
  });
});
