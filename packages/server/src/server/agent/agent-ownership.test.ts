import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import { buildStoredAgentPayload, toAgentPayload } from "./agent-projections.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentSession,
  AgentStreamEvent,
} from "./agent-sdk-types.js";
import { claudeProjectDirSync } from "./providers/claude/project-dir.js";
import {
  INITIAL_AGENT_OWNERSHIP,
  deriveAgentOwnershipValue,
  ownershipOnAcquire,
  ownershipOnAttachFailure,
  ownershipOnExternalChange,
  ownershipOnRelease,
  ownershipWithExternalActivity,
  ownershipWithProcessLiveness,
  ownershipWithTranscriptVisibility,
  restoreAgentOwnership,
} from "./agent-ownership.js";

// B4-OWNERSHIP (batch-4 F8): the ownership state machine, pure. Every case below
// is one of the F8 rulings (R2-lite / R3 / R5) or one of the provider-semantics
// boundaries measured in RESEARCH-provider-dual-write.md that the rules must hold
// against.

const DEAD = { processAlive: false };
const LIVE = { processAlive: true };

describe("deriveAgentOwnershipValue", () => {
  it("reports paseo whenever the daemon's provider process holds the session", () => {
    expect(
      deriveAgentOwnershipValue({
        ...LIVE,
        transcriptObservable: false,
        externalChangeObserved: false,
      }),
    ).toBe("paseo");
    // A live process plus an external write is the dual-writer window: paseo still
    // holds it (the escalation happens when it lets go), never `external` here.
    expect(
      deriveAgentOwnershipValue({
        ...LIVE,
        transcriptObservable: true,
        externalChangeObserved: true,
      }),
    ).toBe("paseo");
  });

  it("reports none when the transcript cannot be observed at all", () => {
    // Conservative by design: opencode (shared DB) and any provider without path
    // knowledge must never be accused of an external write it cannot be seen doing.
    expect(
      deriveAgentOwnershipValue({
        ...DEAD,
        transcriptObservable: false,
        externalChangeObserved: true,
      }),
    ).toBe("none");
  });

  it("reports external only for a released session with observed foreign bytes", () => {
    expect(
      deriveAgentOwnershipValue({
        ...DEAD,
        transcriptObservable: true,
        externalChangeObserved: true,
      }),
    ).toBe("external");
    expect(
      deriveAgentOwnershipValue({
        ...DEAD,
        transcriptObservable: true,
        externalChangeObserved: false,
      }),
    ).toBe("none");
  });
});

describe("ownershipOnAcquire (R5: resume succeeded)", () => {
  it("claims the session and forgets the previous writer's evidence", () => {
    const releasedExternal = ownershipWithExternalActivity(
      ownershipOnRelease(ownershipOnExternalChange(INITIAL_AGENT_OWNERSHIP), {
        transcriptObservable: true,
      }),
      true,
    );
    expect(releasedExternal.value).toBe("external");

    const reacquired = ownershipOnAcquire(releasedExternal);
    expect(reacquired).toMatchObject({
      value: "paseo",
      processAlive: true,
      externalChangeObserved: false,
      externalLooksActive: false,
    });
    // Transcript knowledge survives — only the foreign-byte evidence resets.
    expect(reacquired.transcriptObservable).toBe(true);
  });
});

describe("ownershipOnRelease (R5: process exited)", () => {
  it("falls back to none when nothing external happened", () => {
    const released = ownershipOnRelease(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), {
      transcriptObservable: true,
      baselineBytes: 1024,
    });
    expect(released).toMatchObject({ value: "none", processAlive: false, baselineBytes: 1024 });
  });

  it("escalates to external when a foreign write was seen while paseo still held it", () => {
    const live = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    // The user resumed the same session in a terminal mid-flight (omp/pi fork,
    // claude deepest-branch hijack): pending evidence decides the release value.
    const withPending = ownershipOnExternalChange(live);
    expect(withPending.value).toBe("paseo");
    expect(ownershipOnRelease(withPending, { transcriptObservable: true })).toMatchObject({
      value: "external",
      processAlive: false,
    });
  });

  it("stays none for a released session whose provider exposes no transcript", () => {
    const released = ownershipOnRelease(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), {
      transcriptObservable: false,
    });
    expect(released.value).toBe("none");
    // Re-asserting blindness must not conjure evidence. The `never external`
    // guarantee for path-less providers is enforced one layer up: the watcher
    // cannot attach, so it can never report a change (pinned in
    // transcript-watch-service.test.ts).
    expect(ownershipWithTranscriptVisibility(released, false).value).toBe("none");
  });
});

describe("ownershipOnExternalChange (R2-lite / R3 watcher evidence)", () => {
  it("marks a released session external and moves the cursor", () => {
    const released = ownershipOnRelease(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), {
      transcriptObservable: true,
      baselineBytes: 40,
    });
    const escalated = ownershipOnExternalChange(released, { baselineBytes: 120 });
    expect(escalated).toMatchObject({ value: "external", baselineBytes: 120 });
  });

  it("is idempotent: a second observation does not double-count", () => {
    const released = ownershipOnRelease(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), {
      transcriptObservable: true,
    });
    const once = ownershipOnExternalChange(released, { baselineBytes: 9 });
    expect(ownershipOnExternalChange(once, { baselineBytes: 12 })).toEqual({
      ...once,
      baselineBytes: 12,
    });
  });
});

describe("externalLooksActive (R4 signal)", () => {
  it("only speaks in the external state", () => {
    const live = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    expect(ownershipWithExternalActivity(live, true).externalLooksActive).toBe(false);

    const released = ownershipOnRelease(live, { transcriptObservable: true });
    expect(ownershipWithExternalActivity(released, true).externalLooksActive).toBe(false);

    const external = ownershipWithExternalActivity(ownershipOnExternalChange(released), true);
    expect(external).toMatchObject({ value: "external", externalLooksActive: true });
    // Losing the signal must not demote the state itself.
    expect(ownershipWithExternalActivity(external, false)).toMatchObject({
      value: "external",
      externalLooksActive: false,
    });
  });
});

describe("ownershipOnAttachFailure (R4-27: a failed re-attach erases nothing)", () => {
  it("keeps proven evidence when the transcript cannot be resolved this time", () => {
    const observed = ownershipWithTranscriptVisibility(
      ownershipOnRelease(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), {
        transcriptObservable: true,
        baselineBytes: 4096,
      }),
      true,
      4096,
    );
    expect(ownershipOnAttachFailure(observed)).toBe(observed);
    const pending = ownershipOnExternalChange(observed);
    expect(ownershipOnAttachFailure(pending)).toBe(pending);
  });

  it("settles a never-observed session to unobservable (nothing was proven yet)", () => {
    const released = ownershipOnRelease(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), {
      transcriptObservable: true,
    });
    // R4-01: acquiring cleared the cursor, so this session has no evidence.
    expect(ownershipOnAttachFailure(released)).toMatchObject({
      transcriptObservable: false,
      value: "none",
    });
  });
});

describe("restoreAgentOwnership (daemon restart)", () => {
  it("re-derives a persisted paseo as a release — provider processes die with the daemon", () => {
    const restored = restoreAgentOwnership({ ownership: "paseo", baselineBytes: 10 });
    expect(restored).toMatchObject({ value: "none", processAlive: false });
  });

  it("keeps an external observation across the restart, cursor included", () => {
    const restored = restoreAgentOwnership({
      ownership: "external",
      externalLooksActive: true,
      baselineBytes: 2048,
    });
    expect(restored).toMatchObject({
      value: "external",
      externalLooksActive: true,
      baselineBytes: 2048,
      transcriptObservable: true,
    });
  });

  it("treats a pre-ownership record as unclaimed", () => {
    expect(restoreAgentOwnership({})).toMatchObject({ value: "none", baselineBytes: null });
  });
});

describe("ownershipWithTranscriptVisibility", () => {
  it("gains and loses observability without inventing an external write", () => {
    const acquired = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    const releasedBlind = ownershipOnRelease(acquired, { transcriptObservable: false });
    expect(releasedBlind.value).toBe("none");

    const seen = ownershipWithTranscriptVisibility(releasedBlind, true, 77);
    expect(seen).toMatchObject({ value: "none", transcriptObservable: true, baselineBytes: 77 });

    const external = ownershipOnExternalChange(seen);
    expect(external.value).toBe("external");
    // Losing the path again re-applies the conservative rule: with no observable
    // transcript the daemon may not accuse anyone of an external write.
    expect(ownershipWithTranscriptVisibility(external, false).value).toBe("none");
  });
});

describe("ownershipWithProcessLiveness (provider answers directly)", () => {
  it("returns the same state when the answer matches what is recorded", () => {
    const acquired = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    expect(ownershipWithProcessLiveness(acquired, true)).toBe(acquired);
    const released = ownershipOnRelease(acquired, { transcriptObservable: true });
    expect(ownershipWithProcessLiveness(released, false)).toBe(released);
  });

  it("settles a pending external observation at the moment of death, not at close", () => {
    // The R5 release rule, applied by the process report itself: a child that
    // crashes between turns never reaches `prepareAgentForClosure` on its own,
    // so without this the value stayed `paseo` and `externalLooksActive` was
    // zeroed with it (withValue only keeps that flag in `external`).
    const acquired = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    const observed = ownershipWithTranscriptVisibility(
      ownershipOnExternalChange(acquired),
      true,
      120,
    );
    expect(observed.value).toBe("paseo");

    const dead = ownershipWithProcessLiveness(observed, false);
    expect(dead).toMatchObject({
      value: "external",
      processAlive: false,
      transcriptObservable: true,
      baselineBytes: 120,
    });
  });

  it("falls back to none when the process died and nothing external was seen", () => {
    const acquired = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    expect(ownershipWithProcessLiveness(acquired, false).value).toBe("none");
  });

  it("re-claims the session when a process is behind it again", () => {
    const acquired = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    const dead = ownershipWithProcessLiveness(
      ownershipOnExternalChange(ownershipWithTranscriptVisibility(acquired, true, 10)),
      false,
    );
    expect(dead.value).toBe("external");
    expect(ownershipWithProcessLiveness(dead, true).value).toBe("paseo");
  });

  it("arms the R4 signal only once the settled value is external", () => {
    const observed = ownershipOnExternalChange(
      ownershipWithTranscriptVisibility(ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP), true, 10),
    );
    expect(observed.value).toBe("paseo");
    // While paseo holds the session the flag is not a statement about anybody.
    expect(ownershipWithExternalActivity(observed, true).externalLooksActive).toBe(false);

    const dead = ownershipWithProcessLiveness(observed, false);
    expect(dead.value).toBe("external");
    expect(ownershipWithExternalActivity(dead, true).externalLooksActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The same rules through AgentManager: the real projection chain (record → wire),
// the real transcript funnel (claude's computed project path), and the watcher
// driven by an explicit sweep instead of the interval.
// ---------------------------------------------------------------------------

function claudeLine(role: "user" | "assistant", text: string, uuid: string): string {
  return `${JSON.stringify({
    type: role,
    uuid,
    isSidechain: false,
    message: { role, content: [{ type: "text", text }] },
  })}\n`;
}

describe("AgentManager ownership accounting", () => {
  it("releases to none, escalates to external on a foreign write, and re-acquires on resume", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-"));
    const configDir = join(work, "claude-config");
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const logger = createTestLogger();
    const storage = new AgentStorage(join(work, "agents"), logger);
    const manager = new AgentManager({
      clients: { claude: createTestAgentClient("claude") },
      registry: storage,
      // The interval must never fire here; sweeps are driven explicitly.
      transcriptStatPollIntervalMs: 60 * 60 * 1000,
      logger,
    });
    const states: AgentSnapshotPayload[] = [];
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === "agent_state") {
        states.push(toAgentPayload(event.agent));
      }
    });

    try {
      const agent = await manager.createAgent({ provider: "claude", cwd: work }, undefined, {
        workspaceId: undefined,
      });
      const sessionId = agent.persistence?.sessionId ?? "";
      expect(agent.ownership.value).toBe("paseo");

      // The provider process wrote its own rows; the transcript exists on disk.
      const projectDir = claudeProjectDirSync(work, { configDir });
      mkdirSync(projectDir, { recursive: true });
      const transcript = join(projectDir, `${sessionId}.jsonl`);
      writeFileSync(transcript, claudeLine("user", "from the phone", "u1"));

      await manager.closeAgent(agent.id);
      await manager.flush();

      // Released with no foreign bytes: unclaimed, and now watchable.
      let record = await storage.get(agent.id);
      expect(record?.ownership).toBe("none");
      expect(record?.ownershipBaselineBytes).toBe(
        Buffer.byteLength(claudeLine("user", "from the phone", "u1")),
      );

      // The user continues in their own terminal.
      appendFileSync(transcript, claudeLine("assistant", "continued at the desk", "a2"));
      states.length = 0;
      await manager.sweepTranscriptWatch();

      record = await storage.get(agent.id);
      expect(record?.ownership).toBe("external");
      // R3: the synced row reaches the chat-list projection without a reload.
      expect(record?.lastMessagePreview).toBe("continued at the desk");
      expect(record?.lastMessageRole).toBe("assistant");
      expect(states.at(-1)).toMatchObject({ ownership: "external", externalLooksActive: false });
      expect(buildStoredAgentPayload(record!, ["claude"])).toMatchObject({
        ownership: "external",
        lastMessagePreview: "continued at the desk",
      });

      // R5: sending into it resumes a paseo-owned process and claims it back.
      const resumed = await manager.resumeAgentFromPersistence(
        record!.persistence as AgentPersistenceHandle,
        undefined,
        agent.id,
      );
      expect(resumed.ownership.value).toBe("paseo");
      expect((await storage.get(agent.id))?.ownership).toBe("paseo");
    } finally {
      unsubscribe();
      manager.stopTranscriptWatch();
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("never escalates a provider whose transcript it cannot locate", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-blind-"));
    const logger = createTestLogger();
    const storage = new AgentStorage(join(work, "agents"), logger);
    const manager = new AgentManager({
      clients: { opencode: createTestAgentClient("opencode") },
      registry: storage,
      transcriptStatPollIntervalMs: 60 * 60 * 1000,
      logger,
    });
    try {
      const agent = await manager.createAgent({ provider: "opencode", cwd: work }, undefined, {
        workspaceId: undefined,
      });
      await manager.closeAgent(agent.id);
      await manager.flush();
      await manager.sweepTranscriptWatch();

      const record = await storage.get(agent.id);
      expect(record?.ownership).toBe("none");
    } finally {
      manager.stopTranscriptWatch();
      rmSync(work, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Batch-4 review fix batch A: R4-01 (a failed turn's own bytes must never be
// attributed to a foreign writer), R4-03 (a discovery attach's baseline must
// reach storage), R4-04 (a meta-row-only advance must not float the row).
// ---------------------------------------------------------------------------

async function drainStream(stream: AsyncGenerator<unknown>): Promise<void> {
  for await (const _event of stream) {
    // Subscriptions carry the state; draining only advances the fake turn.
  }
}

function makeReleasedClaudeRecord(input: {
  id: string;
  cwd: string;
  sessionId: string;
  updatedAt: string;
  baselineBytes: number | null;
}): StoredAgentRecord {
  return {
    id: input.id,
    provider: "claude",
    cwd: input.cwd,
    workspaceId: "ws-released",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: input.updatedAt,
    config: { provider: "claude", cwd: input.cwd },
    persistence: { provider: "claude", sessionId: input.sessionId },
    ownership: "none",
    externalLooksActive: false,
    ownershipBaselineBytes: input.baselineBytes,
  };
}

/**
 * The fake claude client, wrapped so a test can deliver a spontaneous
 * `turn_failed` while NO foreground stream is open — the production shape of
 * "the provider process died" (R4-01's trigger). The fake's own turn_failed
 * arrives inside the foreground generator, which the manager treats as a
 * foreground terminal and never observes; only the no-foreground path calls
 * `observeReleasedTranscript`.
 */
function createCrashableClaudeClient(): { client: AgentClient; crash: () => void } {
  const inner = createTestAgentClient("claude");
  let emit: ((event: AgentStreamEvent) => void) | null = null;
  const wrapSession = (session: AgentSession): AgentSession =>
    new Proxy(session, {
      get(target, prop, receiver) {
        if (prop === "subscribe") {
          return (callback: (event: AgentStreamEvent) => void) => {
            emit = callback;
            return target.subscribe(callback);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const client = new Proxy(inner, {
    get(target, prop) {
      if (prop === "createSession") {
        return async (...args: Parameters<AgentClient["createSession"]>) =>
          wrapSession(await target.createSession(...args));
      }
      if (prop === "resumeSession") {
        return async (...args: Parameters<AgentClient["resumeSession"]>) =>
          wrapSession(await target.resumeSession(...args));
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    client,
    crash: () => {
      emit?.({ type: "turn_failed", provider: "claude", error: "provider process died" });
    },
  };
}

function createHarness(work: string, client?: AgentClient) {
  const logger = createTestLogger();
  const storage = new AgentStorage(join(work, "agents"), logger);
  const manager = new AgentManager({
    clients: { claude: client ?? createTestAgentClient("claude") },
    registry: storage,
    transcriptStatPollIntervalMs: 60 * 60 * 1000,
    logger,
  });
  const configDir = join(work, "claude-config");
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const projectDir = claudeProjectDirSync(work, { configDir });
  mkdirSync(projectDir, { recursive: true });
  return {
    storage,
    manager,
    projectDir,
    cleanup: () => {
      manager.stopTranscriptWatch();
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      rmSync(work, { recursive: true, force: true });
    },
  };
}

describe("AgentManager transcript byte attribution (R4-01/03/04)", () => {
  it("does not read a failed turn's own transcript bytes back as an external write (R4-01)", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-failed-turn-"));
    const { client, crash } = createCrashableClaudeClient();
    const harness = createHarness(work, client);
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      const transcript = join(harness.projectDir, `${agent.persistence?.sessionId ?? ""}.jsonl`);

      // Turn 1: the provider journal holds the prompt row, then the process
      // dies outside any foreground stream. The failed-turn observation starts
      // watching and baselines the transcript as paseo left it.
      writeFileSync(transcript, claudeLine("user", "first turn", "u1"));
      crash();
      await harness.manager.flush();

      // Retry: the provider writes the retry row to its journal, then the retry
      // turn fails too. Pre-fix, acquire never detached the watcher and never
      // moved the cursor, so the next check read paseo's OWN retry bytes back
      // as a foreign writer's work: duplicate timeline rows plus a sticky
      // pending that flips to `external` the moment the session is released.
      appendFileSync(transcript, claudeLine("user", "retry — Emit a turn failure", "u2"));
      await drainStream(
        harness.manager.streamAgent(agent.id, "retry — Emit a turn failure", {
          clientMessageId: "cm2",
        }),
      );
      await harness.manager.flush();
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const retryRows = harness.manager
        .getTimeline(agent.id)
        .filter(
          (item) => item.type === "user_message" && item.text === "retry — Emit a turn failure",
        );
      expect(retryRows).toHaveLength(1);

      await harness.manager.closeAgent(agent.id);
      await harness.manager.flush();

      const record = await harness.storage.get(agent.id);
      expect(record?.ownership).toBe("none");
      expect(record?.ownershipBaselineBytes).toBe(
        Buffer.byteLength(
          claudeLine("user", "first turn", "u1") +
            claudeLine("user", "retry — Emit a turn failure", "u2"),
        ),
      );
    } finally {
      harness.cleanup();
    }
  });

  it("persists the baseline a discovery attach establishes (R4-03)", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-discovery-baseline-"));
    const harness = createHarness(work);
    const updatedAt = new Date(Date.now() - 60_000).toISOString();
    try {
      await harness.storage.initialize();
      const content = claudeLine("user", "left from the terminal", "x1");
      const transcript = join(harness.projectDir, "sid-discovery.jsonl");
      writeFileSync(transcript, content);
      await harness.storage.upsert(
        makeReleasedClaudeRecord({
          id: "agent-discovery",
          cwd: work,
          sessionId: "sid-discovery",
          updatedAt,
          baselineBytes: null, // upgraded / crashed record: never observed
        }),
      );

      await harness.manager.sweepTranscriptWatch();

      // Pre-fix the sweep discarded `attach`'s return value: the record stayed
      // null forever and the next restart silently swallowed these bytes as its
      // baseline — the down-window writes became permanently invisible.
      const record = await harness.storage.get("agent-discovery");
      expect(record?.ownershipBaselineBytes).toBe(Buffer.byteLength(content));
      expect(record?.ownership).toBe("none");
      expect(record?.updatedAt).toBe(updatedAt);

      // With the baseline durable, growth past it is real foreign evidence.
      appendFileSync(transcript, claudeLine("assistant", "while daemon down", "x2"));
      await harness.manager.sweepTranscriptWatch();
      expect((await harness.storage.get("agent-discovery"))?.ownership).toBe("external");
    } finally {
      harness.cleanup();
    }
  });

  it("does not bump updatedAt for a meta-row-only transcript advance (R4-04)", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-meta-row-"));
    const harness = createHarness(work);
    const updatedAt = new Date(Date.now() - 60_000).toISOString();
    try {
      await harness.storage.initialize();
      const first = claudeLine("user", "real message", "u1");
      const meta = `${JSON.stringify({ type: "last-prompt", prompt: "volatile control row" })}\n`;
      const transcript = join(harness.projectDir, "sid-meta.jsonl");
      writeFileSync(transcript, first);
      await harness.storage.upsert(
        makeReleasedClaudeRecord({
          id: "agent-meta",
          cwd: work,
          sessionId: "sid-meta",
          updatedAt,
          baselineBytes: Buffer.byteLength(first),
        }),
      );

      // claude interleaves volatile meta rows (last-prompt/mode/queue-operation)
      // per turn: bytes moved, no chat-visible row. The cursor and the ownership
      // evidence must commit — but the row must not float to the top of the
      // time-ordered list (same posture as every other derived observation).
      appendFileSync(transcript, meta);
      await harness.manager.sweepTranscriptWatch();

      const record = await harness.storage.get("agent-meta");
      expect(record?.ownershipBaselineBytes).toBe(Buffer.byteLength(first + meta));
      expect(record?.ownership).toBe("external");
      expect(record?.updatedAt).toBe(updatedAt);
    } finally {
      harness.cleanup();
    }
  });

  it("does not arm the external pending when the dedup belt swallows every row (R4-33)", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-dedup-badge-"));
    const { client, crash } = createCrashableClaudeClient();
    const harness = createHarness(work, client);
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      const transcript = join(harness.projectDir, `${agent.persistence?.sessionId ?? ""}.jsonl`);

      // A foreground turn fails; its prompt row is in the timeline AND in the
      // provider journal. The spontaneous failure observation then baselines.
      await drainStream(
        harness.manager.streamAgent(agent.id, "Emit a turn failure", { clientMessageId: "cm1" }),
      );
      writeFileSync(transcript, claudeLine("user", "Emit a turn failure", "u1"));
      crash();
      await harness.manager.flush();

      // A same-text row lands at the tail (death-flush echo of the recorded
      // prompt). The belt swallows it whole — row level is already handled —
      // so the OBSERVATION must be treated as settled: cursor advances, but no
      // `externalChangeObserved` is armed and the badge stays honest.
      appendFileSync(transcript, claudeLine("user", "Emit a turn failure", "u2"));
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect(
        harness.manager
          .getTimeline(agent.id)
          .filter((item) => item.type === "user_message" && item.text === "Emit a turn failure"),
      ).toHaveLength(1);

      await harness.manager.closeAgent(agent.id);
      await harness.manager.flush();
      const record = await harness.storage.get(agent.id);
      expect(record?.ownership).toBe("none");
      expect(record?.ownershipBaselineBytes).toBe(
        Buffer.byteLength(
          claudeLine("user", "Emit a turn failure", "u1") +
            claudeLine("user", "Emit a turn failure", "u2"),
        ),
      );
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// B4-OWNERSHIP precision: `AgentSession.isAlive` feeds the state machine the
// process fact directly, instead of the manager inferring it from "I still hold
// a session object" (which a crashed child never invalidates).
// ---------------------------------------------------------------------------

function createLivenessClaudeClient(): {
  client: AgentClient;
  crash: () => void;
  setAlive: (alive: boolean) => void;
} {
  const inner = createTestAgentClient("claude");
  let emit: ((event: AgentStreamEvent) => void) | null = null;
  let alive = true;
  const wrapSession = (session: AgentSession): AgentSession =>
    new Proxy(session, {
      get(target, prop, receiver) {
        if (prop === "subscribe") {
          return (callback: (event: AgentStreamEvent) => void) => {
            emit = callback;
            return target.subscribe(callback);
          };
        }
        if (prop === "isAlive") {
          return () => alive;
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const client = new Proxy(inner, {
    get(target, prop) {
      if (prop === "createSession") {
        return async (...args: Parameters<AgentClient["createSession"]>) =>
          wrapSession(await target.createSession(...args));
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    client,
    crash: () => {
      emit?.({ type: "turn_failed", provider: "claude", error: "provider process died" });
    },
    setAlive: (next: boolean) => {
      alive = next;
    },
  };
}

describe("AgentManager process-liveness reporting (isAlive)", () => {
  it("settles a dead provider process and lets the foreign write escalate immediately", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-liveness-"));
    const { client, crash, setAlive } = createLivenessClaudeClient();
    const harness = createHarness(work, client);
    let agentId: string | null = null;
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      agentId = agent.id;
      expect(agent.ownership.value).toBe("paseo");
      const transcript = join(harness.projectDir, `${agent.persistence?.sessionId ?? ""}.jsonl`);
      writeFileSync(transcript, claudeLine("user", "from the phone", "u1"));

      // The provider process dies between turns. Pre-fix this was invisible: the
      // only death evidence the manager got was the failed turn, and it kept
      // claiming the session until someone closed it.
      setAlive(false);
      crash();
      await harness.manager.flush();
      expect(harness.manager.getAgent(agent.id)?.ownership.value).toBe("none");

      // The user continues in their own terminal. With the process fact settled,
      // the watcher's observation escalates NOW (R4's precondition) instead of
      // staying a pending change behind a `paseo` value.
      appendFileSync(transcript, claudeLine("assistant", "continued at the desk", "a2"));
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      expect(harness.manager.getAgent(agent.id)?.ownership.value).toBe("external");
      expect((await harness.storage.get(agent.id))?.ownership).toBe("external");
    } finally {
      if (agentId) await harness.manager.closeAgent(agentId).catch(() => undefined);
      harness.cleanup();
    }
  });

  it("keeps the claim when the process answers alive, and keeps the inference when it cannot answer", async () => {
    const liveWork = mkdtempSync(join(tmpdir(), "agent-ownership-liveness-alive-"));
    const live = createLivenessClaudeClient();
    const liveHarness = createHarness(liveWork, live.client);
    const blindWork = mkdtempSync(join(tmpdir(), "agent-ownership-liveness-blind-"));
    const blind = createCrashableClaudeClient();
    const blindHarness = createHarness(blindWork, blind.client);
    let liveAgentId: string | null = null;
    let blindAgentId: string | null = null;
    try {
      const liveAgent = await liveHarness.manager.createAgent(
        { provider: "claude", cwd: liveWork },
        undefined,
        { workspaceId: undefined },
      );
      liveAgentId = liveAgent.id;
      // An ordinary turn error with the process still serving: no release.
      live.crash();
      await liveHarness.manager.flush();
      expect(liveHarness.manager.getAgent(liveAgent.id)?.ownership.value).toBe("paseo");

      // opencode / plugin posture: no `isAlive` = no evidence, inference stands.
      const blindAgent = await blindHarness.manager.createAgent(
        { provider: "claude", cwd: blindWork },
        undefined,
        { workspaceId: undefined },
      );
      blindAgentId = blindAgent.id;
      blind.crash();
      await blindHarness.manager.flush();
      expect(blindHarness.manager.getAgent(blindAgent.id)?.ownership.value).toBe("paseo");
    } finally {
      if (liveAgentId) await liveHarness.manager.closeAgent(liveAgentId).catch(() => undefined);
      if (blindAgentId) await blindHarness.manager.closeAgent(blindAgentId).catch(() => undefined);
      // Reverse order: each harness restores the CLAUDE_CONFIG_DIR it found.
      blindHarness.cleanup();
      liveHarness.cleanup();
    }
  });
});
