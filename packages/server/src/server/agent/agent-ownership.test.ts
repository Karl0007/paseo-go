import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import { IMPORTED_PROVIDER_SESSION_LABEL } from "@getpaseo/protocol/agent-labels";
import {
  buildStoredAgentPayload,
  toAgentListItemPayload,
  toAgentPayload,
} from "./agent-projections.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentSession,
  AgentStreamEvent,
} from "./agent-sdk-types.js";
import { claudeProjectDirSync } from "./providers/claude/project-dir.js";
import { LOOKS_ACTIVE_MTIME_WINDOW_MS } from "./provider-transcript.js";
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
  it("reports paseo while the daemon holds the session with no foreign evidence", () => {
    expect(
      deriveAgentOwnershipValue({
        ...LIVE,
        transcriptObservable: false,
        externalChangeObserved: false,
      }),
    ).toBe("paseo");
    // B9-WATCH2 (F33): the dual-writer window inverted. A live process with no
    // turn in flight never writes its transcript — the manager detaches the
    // watcher and re-acquires around every run — so an observed foreign write
    // outranks the idle hold: the pill follows the WRITER, and the next turn
    // start (acquire) re-pins `paseo`.
    expect(
      deriveAgentOwnershipValue({
        ...LIVE,
        transcriptObservable: true,
        externalChangeObserved: true,
      }),
    ).toBe("external");
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
    // claude deepest-branch hijack). B9-WATCH2 (F33): the evidence escalates
    // the moment it is observed — the pill must not wait for a release that
    // may never come while the app just holds the chat open. Exiting with
    // the evidence pending still lands on `external` (the R5 fallback below).
    const withPending = ownershipOnExternalChange(live);
    expect(withPending.value).toBe("external");
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

  it("carries the escalated observation through the moment of death", () => {
    // B9-WATCH2 (F33): the observation escalates the moment it is recorded —
    // even while the process still answers alive (an idle hold never writes).
    // The death report then settles the PROCESS fact, which close may never
    // deliver on its own (a crashed child only surfaces as `turn_failed`).
    const acquired = ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP);
    const observed = ownershipWithTranscriptVisibility(
      ownershipOnExternalChange(acquired),
      true,
      120,
    );
    expect(observed.value).toBe("external");

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
    // A restarted daemon process continues the conversation itself: the
    // re-claim consumes the stale foreign evidence, exactly like a resume.
    const reclaimed = ownershipWithProcessLiveness(dead, true);
    expect(reclaimed.value).toBe("paseo");
    expect(reclaimed.externalChangeObserved).toBe(false);
  });

  it("arms the R4 signal on the escalated observation, not on the bare hold", () => {
    // B9-WATCH2 (F33): fresh foreign bytes on a live-idle session ARE the
    // external state, so the 「运行中」 flag arms with them — the F33 pill.
    // A hold without evidence is still not a statement about anybody.
    const held = ownershipWithTranscriptVisibility(
      ownershipOnAcquire(INITIAL_AGENT_OWNERSHIP),
      true,
      10,
    );
    expect(ownershipWithExternalActivity(held, true).externalLooksActive).toBe(false);

    const observed = ownershipOnExternalChange(held);
    expect(observed.value).toBe("external");
    expect(ownershipWithExternalActivity(observed, true)).toMatchObject({
      value: "external",
      externalLooksActive: true,
    });

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
      expect(states.at(-1)).toMatchObject({
        ownership: "external",
        externalLooksActive: false,
        // B6-OWN-HEAL: the birth axis rides the live projection too — the pill must
        // not blink to 未知 while a turn is running.
        origin: "launch",
      });
      expect(buildStoredAgentPayload(record!, ["claude"])).toMatchObject({
        ownership: "external",
        lastMessagePreview: "continued at the desk",
        origin: "launch",
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

describe("agentOrigin projection (B6-OWN-HEAL birth axis)", () => {
  const released = {
    id: "agent-origin",
    cwd: "/work/repo",
    sessionId: "s-origin",
    updatedAt: "2026-09-30T00:00:00.000Z",
    baselineBytes: null,
  };

  function storedWithLabels(labels: Record<string, string>): StoredAgentRecord {
    return { ...makeReleasedClaudeRecord(released), labels };
  }

  it("answers launch for a record the import screen never stamped", () => {
    // The F19 case: pre-B4 records carry no ownership observation, which is why the
    // pill used to have nothing to say. Birth is the fact that always answers.
    expect(buildStoredAgentPayload(storedWithLabels({}), ["claude"]).origin).toBe("launch");
  });

  it("answers import for a session the import screen adopted", () => {
    const imported = storedWithLabels({ [IMPORTED_PROVIDER_SESSION_LABEL]: "true" });
    expect(buildStoredAgentPayload(imported, ["claude"]).origin).toBe("import");
  });

  it("reads the stamp, not a lookalike value", () => {
    // `isImportedProviderSession` is literal "true"; anything else stays launch.
    const forged = storedWithLabels({ [IMPORTED_PROVIDER_SESSION_LABEL]: "TRUE" });
    expect(buildStoredAgentPayload(forged, ["claude"]).origin).toBe("launch");
  });

  it("carries the axis through the list projection (MCP list_agents parity)", () => {
    const imported = storedWithLabels({ [IMPORTED_PROVIDER_SESSION_LABEL]: "true" });
    const payload = buildStoredAgentPayload(imported, ["claude"]);
    expect(toAgentListItemPayload(payload).origin).toBe("import");
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

function createHarness(
  work: string,
  client?: AgentClient,
  managerOptions?: { transcriptChainFollowIntervalMs?: number },
) {
  const logger = createTestLogger();
  const storage = new AgentStorage(join(work, "agents"), logger);
  const manager = new AgentManager({
    clients: { claude: client ?? createTestAgentClient("claude") },
    registry: storage,
    transcriptStatPollIntervalMs: 60 * 60 * 1000,
    transcriptChainFollowIntervalMs: managerOptions?.transcriptChainFollowIntervalMs,
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

// ---------------------------------------------------------------------------
// B9-WATCH2 (batch-9 F33): the live-idle blind spot. The app holds a session
// open (resumed, no turn running) while the user runs that very conversation
// in their terminal. Pre-fix the candidate filter skipped EVERY live agent,
// so the watcher never attached, the foreign bytes were never observed, and
// the pill stayed 「原生」 no matter how long the terminal kept writing.
// ---------------------------------------------------------------------------

/** A claude live-process registry entry the R4 probe answers `active` to. */
function writeClaudeRegistryEntry(input: { configDir: string; sessionId: string }): void {
  const sessionsDir = join(input.configDir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  // The probe only trusts a positive pid answering signal-0 — the test process
  // itself is the cheapest pid guaranteed to be alive here.
  writeFileSync(
    join(sessionsDir, `${process.pid}.json`),
    JSON.stringify({ sessionId: input.sessionId, pid: process.pid }),
  );
}

function waitForRunning(manager: AgentManager, agentId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsubscribe = manager.subscribe(
      (event) => {
        if (
          event.type === "agent_state" &&
          event.agent.id === agentId &&
          event.agent.lifecycle === "running"
        ) {
          unsubscribe();
          resolve();
        }
      },
      { agentId, replayState: false },
    );
  });
}

describe("AgentManager live-idle transcript watching (B9-WATCH2, F33)", () => {
  it("flips a held-open session to external·running when the terminal writes it", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-live-idle-"));
    const harness = createHarness(work);
    let agentId: string | null = null;
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      agentId = agent.id;
      await harness.manager.flush();
      const sessionId = agent.persistence?.sessionId ?? "";
      const transcript = join(harness.projectDir, `${sessionId}.jsonl`);
      writeFileSync(transcript, claudeLine("user", "from the phone", "u1"));

      // The sweep now attaches to the live-IDLE session and baselines it;
      // holding the session without a turn keeps the claim itself.
      await harness.manager.sweepTranscriptWatch();
      expect(harness.manager.getAgent(agent.id)?.ownership.value).toBe("paseo");

      // The user continues at the desk: a foreign row lands, and claude's
      // live-process registry says that terminal is still running.
      appendFileSync(transcript, claudeLine("user", "continued at the desk", "u2"));
      writeClaudeRegistryEntry({ configDir: join(work, "claude-config"), sessionId });
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      // Pre-fix: no entry existed, so this stayed `paseo` forever — the exact
      // F33 screenshot (terminal running, pill 「原生」).
      const live = harness.manager.getAgent(agent.id);
      expect(live?.ownership.value).toBe("external");
      expect(live?.ownership.externalLooksActive).toBe(true);
    } finally {
      if (agentId) await harness.manager.closeAgent(agentId).catch(() => undefined);
      harness.cleanup();
    }
  });

  it("never attributes the daemon's own bytes: busy is set before the first write (race 1)", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-live-idle-busy-"));
    const harness = createHarness(work);
    let agentId: string | null = null;
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      agentId = agent.id;
      await harness.manager.flush();
      const transcript = join(harness.projectDir, `${agent.persistence?.sessionId ?? ""}.jsonl`);
      writeFileSync(transcript, claudeLine("user", "first turn", "u1"));
      await harness.manager.sweepTranscriptWatch();

      // The user sends from the app: lifecycle goes running BEFORE the
      // provider process appends its row (turn_started is dispatched on
      // prompt accept), and `onStreamTurnStarted` detached the watcher +
      // re-acquired at that same moment. The row lands mid-turn.
      const running = waitForRunning(harness.manager, agent.id);
      const draining = drainStream(
        harness.manager.streamAgent(agent.id, "second turn", { clientMessageId: "cm2" }),
      );
      await running;
      appendFileSync(transcript, claudeLine("user", "second turn", "u2"));
      await draining;
      await harness.manager.flush();

      // The post-turn sweep re-attaches with the acquire-reset cursor: it
      // baselines AT the current size, so paseo's own row is never read back.
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      const live = harness.manager.getAgent(agent.id);
      expect(live?.ownership.value).toBe("paseo");
      expect(live?.ownership.externalLooksActive).toBe(false);

      // B9-12 (REVIEW-B9-12): prove that `paseo` above is a BASELINE, not
      // blindness — a foreign row landing now must flip the pill. Remove the
      // live-idle candidate filter (the gate this race test guards) and the
      // watcher never attaches, the `paseo` assertions pass vacuously, and
      // THIS assertion goes red instead.
      appendFileSync(transcript, claudeLine("assistant", "continued at the desk", "u3"));
      writeClaudeRegistryEntry({
        configDir: join(work, "claude-config"),
        sessionId: agent.persistence?.sessionId ?? "",
      });
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect(harness.manager.getAgent(agent.id)?.ownership.value).toBe("external");
    } finally {
      if (agentId) await harness.manager.closeAgent(agentId).catch(() => undefined);
      harness.cleanup();
    }
  });

  it("the next acquire re-pins paseo after a flip (race 2: correction)", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-live-idle-acquire-"));
    const harness = createHarness(work);
    let agentId: string | null = null;
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      agentId = agent.id;
      await harness.manager.flush();
      const sessionId = agent.persistence?.sessionId ?? "";
      const transcript = join(harness.projectDir, `${sessionId}.jsonl`);
      writeFileSync(transcript, claudeLine("user", "from the phone", "u1"));
      await harness.manager.sweepTranscriptWatch();
      appendFileSync(transcript, claudeLine("user", "continued at the desk", "u2"));
      writeClaudeRegistryEntry({ configDir: join(work, "claude-config"), sessionId });
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect(harness.manager.getAgent(agent.id)?.ownership.value).toBe("external");

      // Whatever the pill said, sending a prompt from paseo takes the session
      // back: acquire clears the evidence and the R4 flag with it.
      await drainStream(
        harness.manager.streamAgent(agent.id, "paseo takes it back", { clientMessageId: "cm3" }),
      );
      await harness.manager.flush();
      const live = harness.manager.getAgent(agent.id);
      expect(live?.ownership.value).toBe("paseo");
      expect(live?.ownership.externalLooksActive).toBe(false);
    } finally {
      if (agentId) await harness.manager.closeAgent(agentId).catch(() => undefined);
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// B9-SUBACT (F31 ruling B+): the tree contagion at the manager surface. An
// active child directory must flip a released omp agent to `external`·running
// and persist the badge count — without bumping `updatedAt` (a derived
// observation never reorders the time-ordered list) — and the import overlay's
// live answer must reach callers through the manager.
// ---------------------------------------------------------------------------

describe("AgentManager subagent-tree contagion (B9-SUBACT)", () => {
  it("flips a released omp agent on an active child tree and persists the count", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-subagent-tree-"));
    const harness = createHarness(work);
    try {
      const transcript = join(work, "sessions", "parent.jsonl");
      mkdirSync(dirname(transcript), { recursive: true });
      writeFileSync(
        transcript,
        `${JSON.stringify({
          type: "session",
          id: "sess-sub",
          cwd: work,
          timestamp: "2026-10-02T00:00:00.000Z",
        })}\n`,
      );
      const record: StoredAgentRecord = {
        id: "agent-sub",
        provider: "omp",
        cwd: work,
        createdAt: "2026-10-02T00:00:00.000Z",
        updatedAt: "2026-10-02T00:00:00.000Z",
        labels: {},
        lastStatus: "closed",
        config: null,
        persistence: { provider: "omp", sessionId: "sess-sub", nativeHandle: transcript },
      };
      await harness.storage.upsert(record);

      // omp's child layout: a directory named after the parent stem.
      const childDir = transcript.slice(0, -".jsonl".length);
      mkdirSync(childDir, { recursive: true });
      const child = join(childDir, "Explore.jsonl");
      writeFileSync(child, `${JSON.stringify({ type: "session", id: "sess-child", cwd: work })}\n`);

      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const stored = await harness.storage.get("agent-sub");
      expect(stored).not.toBeNull();
      // Contagion (card §2): daemon writes nothing, the subtree grows → the pill
      // answers 外部·运行中, and the count rides the record for the badge.
      expect(stored?.ownership).toBe("external");
      expect(stored?.externalLooksActive).toBe(true);
      expect(stored?.activeSubagents).toBe(1);
      // A derived observation must never reorder the time-ordered chat list.
      expect(stored?.updatedAt).toBe(record.updatedAt);

      // The badge input reaches the wire payload the shell reads.
      expect(buildStoredAgentPayload(stored!, ["omp"]).activeSubagents).toBe(1);

      // The import overlay answers live for the observed child, and stays out
      // of everything else (the parent row keeps its own scan estimate).
      expect(harness.manager.subagentLiveState(child)).toBe(true);
      expect(harness.manager.subagentLiveState(transcript)).toBeNull();
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// B9-REVIEW-G1 (batch-9 review, cards 01/02/06/11): the tree channel at the
// manager surface. A daemon that ran its own subagents must not be told it
// hosts a stranger (01); a count the caller still projects must hear its own
// decay across the entry gap (02); the decay's COMMIT and EMIT layers carry
// tests, not just truthy flips (06); and a reload keeps the badge (11).
// ---------------------------------------------------------------------------

function ompSessionHeader(cwd: string): string {
  return `${JSON.stringify({
    type: "session",
    id: "sess-self",
    cwd,
    timestamp: "2026-10-02T00:00:00.000Z",
  })}\n`;
}

/**
 * The fake omp client, wrapped so every session's persistence carries
 * `nativeHandle` = the transcript path the test controls (an omp handle IS the
 * transcript file; the bare fake names none, and an unresolvable handle would
 * make any live-agent watch assertion vacuous).
 */
function createOmpClientWithTranscript(transcriptPath: string): AgentClient {
  const inner = createTestAgentClient("omp");
  const wrapSession = (session: AgentSession): AgentSession =>
    new Proxy(session, {
      get(target, prop, receiver) {
        if (prop === "describePersistence") {
          return () => ({
            ...(target.describePersistence() as AgentPersistenceHandle),
            nativeHandle: transcriptPath,
          });
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(inner, {
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
}

function createOmpHarness(work: string, transcript: string) {
  const logger = createTestLogger();
  const storage = new AgentStorage(join(work, "agents"), logger);
  const manager = new AgentManager({
    clients: { omp: createOmpClientWithTranscript(transcript) },
    registry: storage,
    transcriptStatPollIntervalMs: 60 * 60 * 1000,
    // The tree-channel tests observe more than one scan per entry; the
    // production 5-min gate would collapse them into one.
    transcriptChainFollowIntervalMs: 0,
    logger,
  });
  return {
    storage,
    manager,
    cleanup: () => {
      manager.stopTranscriptWatch();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

describe("AgentManager self-written tree baseline (B9-01)", () => {
  it("keeps a live-idle agent's own fresh child tree silent: paseo, idle, no count", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-self-tree-"));
    const transcript = join(work, "sessions", "2026-10-02_self.jsonl");
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, ompSessionHeader(work));
    const harness = createOmpHarness(work, transcript);
    let agentId: string | null = null;
    try {
      const agent = await harness.manager.createAgent({ provider: "omp", cwd: work }, undefined, {
        workspaceId: undefined,
      });
      agentId = agent.id;
      await harness.manager.flush();

      // The turn this daemon just ran spawned this child: fresh at attach — the
      // exact false-positive trigger of the card; pre-fix one sweep flipped the
      // pill to 外部·运行中. The 2s-past mtime keeps it unambiguously under the
      // attach floor whatever the clock granularity.
      const childDir = transcript.slice(0, -".jsonl".length);
      mkdirSync(childDir, { recursive: true });
      const ownChild = join(childDir, "Explore.jsonl");
      writeFileSync(ownChild, ompSessionHeader(childDir));
      const ownAt = Date.now() - 2_000;
      utimesSync(ownChild, new Date(ownAt), new Date(ownAt));

      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const live = harness.manager.getAgent(agent.id);
      expect(live?.ownership.value).toBe("paseo");
      expect(live?.ownership.externalLooksActive).toBe(false);
      expect(live?.activeSubagents).toBeUndefined();
      expect(toAgentPayload(live!)).not.toHaveProperty("activeSubagents");
      const record = await harness.storage.get(agent.id);
      expect(record?.ownership).toBe("paseo");
      expect(record?.activeSubagents).toBeUndefined();
    } finally {
      if (agentId) await harness.manager.closeAgent(agentId).catch(() => undefined);
      harness.cleanup();
    }
  });

  it("keeps the released close-attach silent on the same own-child shape", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-self-close-"));
    const transcript = join(work, "sessions", "2026-10-02_close.jsonl");
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, ompSessionHeader(work));
    const harness = createOmpHarness(work, transcript);
    try {
      const agent = await harness.manager.createAgent({ provider: "omp", cwd: work }, undefined, {
        workspaceId: undefined,
      });
      await harness.manager.flush();
      const childDir = transcript.slice(0, -".jsonl".length);
      mkdirSync(childDir, { recursive: true });
      const ownChild = join(childDir, "Explore.jsonl");
      writeFileSync(ownChild, ompSessionHeader(childDir));
      const ownAt = Date.now() - 2_000; // fresh, unambiguously under the floor
      utimesSync(ownChild, new Date(ownAt), new Date(ownAt));

      await harness.manager.closeAgent(agent.id);
      await harness.manager.flush();
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const record = await harness.storage.get(agent.id);
      expect(record?.ownership).toBe("none");
      expect(record?.externalLooksActive).toBeFalsy();
      expect(record?.activeSubagents).toBeUndefined();
    } finally {
      harness.cleanup();
    }
  });
});

describe("AgentManager cross-entry count decay (B9-02)", () => {
  function decayRecord(input: {
    transcript: string;
    baselineBytes: number;
    activeSubagents?: number;
  }): StoredAgentRecord {
    return {
      id: "agent-decay",
      provider: "omp",
      cwd: input.transcript,
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      config: null,
      persistence: { provider: "omp", sessionId: "sess-decay", nativeHandle: input.transcript },
      ownership: "external",
      externalLooksActive: true,
      ownershipBaselineBytes: input.baselineBytes,
      ...(input.activeSubagents !== undefined ? { activeSubagents: input.activeSubagents } : {}),
    };
  }

  function staleTree(work: string): { transcript: string; header: string; stale: number } {
    const transcript = join(work, "sessions", "parent.jsonl");
    mkdirSync(dirname(transcript), { recursive: true });
    const header = ompSessionHeader(work);
    writeFileSync(transcript, header);
    const stale = Date.now() - LOOKS_ACTIVE_MTIME_WINDOW_MS - 60_000;
    utimesSync(transcript, new Date(stale), new Date(stale));
    const childDir = transcript.slice(0, -".jsonl".length);
    mkdirSync(childDir, { recursive: true });
    for (const name of ["A.jsonl", "B.jsonl", "C.jsonl"]) {
      const file = join(childDir, name);
      writeFileSync(file, header);
      utimesSync(file, new Date(stale), new Date(stale));
    }
    return { transcript, header, stale };
  }

  it("tells a persisted 3 → 0 when every child decayed while no entry existed", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-count-decay-"));
    const harness = createHarness(work);
    try {
      const { transcript, header } = staleTree(work);
      const record = decayRecord({
        transcript,
        baselineBytes: Buffer.byteLength(header),
        activeSubagents: 3,
      });
      await harness.storage.upsert(record);

      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const stored = await harness.storage.get("agent-decay");
      // The badge clears and 运行中 goes dark across the restart…
      expect(stored?.activeSubagents).toBe(0);
      expect(stored?.externalLooksActive).toBe(false);
      expect(stored?.ownership).toBe("external");
      // …and a derived observation still never reorders the time-ordered list.
      expect(stored?.updatedAt).toBe(record.updatedAt);
    } finally {
      harness.cleanup();
    }
  });

  it("keeps the zero-report posture for a legacy record without a persisted count", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-count-legacy-"));
    const harness = createHarness(work);
    try {
      const { transcript, header } = staleTree(work);
      const record = decayRecord({ transcript, baselineBytes: Buffer.byteLength(header) });
      await harness.storage.upsert(record);

      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      // No seed = the caller never spoke either: `undefined → 0` stays silent.
      const stored = await harness.storage.get("agent-decay");
      expect(stored?.activeSubagents).toBeUndefined();
      expect(stored?.externalLooksActive).toBe(true);
      expect(stored?.updatedAt).toBe(record.updatedAt);
    } finally {
      harness.cleanup();
    }
  });
});

describe("AgentManager subagent count decay commit and emit (B9-06)", () => {
  it("commits the stored decay to 0 with updatedAt untouched and the payload carrying 0", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-stored-decay-"));
    const harness = createHarness(work, undefined, { transcriptChainFollowIntervalMs: 0 });
    const payloads: AgentSnapshotPayload[] = [];
    // The record id is not a UUID, so the subscription is global and filtered
    // in the callback; `event.agent` is the snapshot, projected like the wire.
    const unsubscribe = harness.manager.subscribe((event) => {
      if (event.type === "agent_state" && event.agent.id === "agent-stored-decay") {
        payloads.push(toAgentPayload(event.agent));
      }
    });
    try {
      const transcript = join(work, "sessions", "parent.jsonl");
      mkdirSync(dirname(transcript), { recursive: true });
      const header = ompSessionHeader(work);
      writeFileSync(transcript, header);
      const childDir = transcript.slice(0, -".jsonl".length);
      mkdirSync(childDir, { recursive: true });
      const child = join(childDir, "A.jsonl");
      writeFileSync(child, header);
      const record: StoredAgentRecord = {
        id: "agent-stored-decay",
        provider: "omp",
        cwd: work,
        createdAt: "2026-10-02T00:00:00.000Z",
        updatedAt: "2026-10-02T00:00:00.000Z",
        labels: {},
        lastStatus: "closed",
        config: null,
        persistence: { provider: "omp", sessionId: "sess-sd", nativeHandle: transcript },
      };
      await harness.storage.upsert(record);

      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect((await harness.storage.get("agent-stored-decay"))?.activeSubagents).toBe(1);

      // The subagent finished: the decay must COMMIT — a falsy-swallowing `||`
      // where the patch resolves `??` leaves the badge stuck on the old value.
      const stale = Date.now() - LOOKS_ACTIVE_MTIME_WINDOW_MS - 60_000;
      utimesSync(child, new Date(stale), new Date(stale));
      utimesSync(transcript, new Date(stale), new Date(stale));
      payloads.length = 0;
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const stored = await harness.storage.get("agent-stored-decay");
      expect(stored?.activeSubagents).toBe(0);
      expect(stored?.externalLooksActive).toBe(false);
      expect(stored?.updatedAt).toBe(record.updatedAt);
      // The dispatch payload the shell reads carries the cleared badge input.
      expect(payloads.at(-1)?.activeSubagents).toBe(0);
      expect(payloads.at(-1)?.externalLooksActive).toBe(false);
    } finally {
      unsubscribe();
      harness.cleanup();
    }
  });

  it("re-emits agent_state when a live agent's child tree decays", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-live-decay-"));
    const transcript = join(work, "sessions", "2026-10-02_live.jsonl");
    mkdirSync(dirname(transcript), { recursive: true });
    const header = ompSessionHeader(work);
    writeFileSync(transcript, header);
    const harness = createOmpHarness(work, transcript);
    const states: AgentSnapshotPayload[] = [];
    let unsubscribe: (() => void) | null = null;
    try {
      const agent = await harness.manager.createAgent({ provider: "omp", cwd: work }, undefined, {
        workspaceId: undefined,
      });
      unsubscribe = harness.manager.subscribe(
        (event) => {
          if (event.type === "agent_state" && event.agent.id === agent.id) {
            states.push(toAgentPayload(event.agent));
          }
        },
        { agentId: agent.id, replayState: false },
      );
      await harness.manager.sweepTranscriptWatch(); // attach; the floor is now

      // A stranger's children under the held-open session, written past the
      // floor (the utimes stands in for the sweep gap without sleeping).
      const childDir = transcript.slice(0, -".jsonl".length);
      mkdirSync(childDir, { recursive: true });
      const future = new Date(Date.now() + 10_000);
      const children = ["A.jsonl", "B.jsonl"].map((name) => {
        const file = join(childDir, name);
        writeFileSync(file, header);
        utimesSync(file, future, future);
        return file;
      });
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect(harness.manager.getAgent(agent.id)?.activeSubagents).toBe(2);

      // The subagents finish: external·running → external changes no ownership
      // VALUE — the emit must ride the count move anyway.
      const stale = Date.now() - LOOKS_ACTIVE_MTIME_WINDOW_MS - 60_000;
      for (const file of children) {
        utimesSync(file, new Date(stale), new Date(stale));
      }
      utimesSync(transcript, new Date(stale), new Date(stale));
      states.length = 0;
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const last = states.at(-1);
      expect(last).toBeDefined();
      expect(last?.activeSubagents).toBe(0);
      expect(last?.externalLooksActive).toBe(false);
      expect(last?.ownership).toBe("external");
    } finally {
      unsubscribe?.();
      harness.cleanup();
    }
  });

  it("re-emits agent_state when only the external-activity flag decays", async () => {
    // The `settled` belt must honour `externalLooksActive`: an observation that
    // moves no value, no count and no row (a torn line after the terminal's
    // registry row is gone) still says 运行中 → 外部 and must reach subscribers.
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-ela-settle-"));
    const harness = createHarness(work);
    const states: AgentSnapshotPayload[] = [];
    let unsubscribe: (() => void) | null = null;
    try {
      const agent = await harness.manager.createAgent(
        { provider: "claude", cwd: work },
        undefined,
        { workspaceId: undefined },
      );
      unsubscribe = harness.manager.subscribe(
        (event) => {
          if (event.type === "agent_state" && event.agent.id === agent.id) {
            states.push(toAgentPayload(event.agent));
          }
        },
        { agentId: agent.id, replayState: false },
      );
      const sessionId = agent.persistence?.sessionId ?? "";
      const transcript = join(harness.projectDir, `${sessionId}.jsonl`);
      writeFileSync(transcript, claudeLine("user", "from the phone", "u1"));
      await harness.manager.sweepTranscriptWatch();
      appendFileSync(transcript, claudeLine("user", "continued at the desk", "u2"));
      writeClaudeRegistryEntry({ configDir: join(work, "claude-config"), sessionId });
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect(harness.manager.getAgent(agent.id)?.ownership.externalLooksActive).toBe(true);

      rmSync(join(work, "claude-config", "sessions", `${process.pid}.json`));
      appendFileSync(transcript, '{"type":"assistant","uuid":"a9","message":');
      states.length = 0;
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();

      const last = states.at(-1);
      expect(last).toBeDefined();
      expect(last?.ownership).toBe("external");
      expect(last?.externalLooksActive).toBe(false);
    } finally {
      unsubscribe?.();
      harness.cleanup();
    }
  });
});

describe("AgentManager reload keeps the tree count (B9-11)", () => {
  it("carries the live count into the rebuilt agent and its record", async () => {
    const work = mkdtempSync(join(tmpdir(), "agent-ownership-reload-count-"));
    const transcript = join(work, "sessions", "2026-10-02_reload.jsonl");
    mkdirSync(dirname(transcript), { recursive: true });
    const header = ompSessionHeader(work);
    writeFileSync(transcript, header);
    const harness = createOmpHarness(work, transcript);
    try {
      const agent = await harness.manager.createAgent({ provider: "omp", cwd: work }, undefined, {
        workspaceId: undefined,
      });
      await harness.manager.flush();
      await harness.manager.sweepTranscriptWatch(); // attach; the floor is now
      const childDir = transcript.slice(0, -".jsonl".length);
      mkdirSync(childDir, { recursive: true });
      const future = new Date(Date.now() + 10_000);
      for (const name of ["A.jsonl", "B.jsonl"]) {
        const file = join(childDir, name);
        writeFileSync(file, header);
        utimesSync(file, future, future);
      }
      await harness.manager.sweepTranscriptWatch();
      await harness.manager.flush();
      expect(harness.manager.getAgent(agent.id)?.activeSubagents).toBe(2);

      // A reload is not a stop: the subagents keep running, so the rebuilt
      // agent and the registry row must both still carry the count.
      const reloaded = await harness.manager.reloadAgentSession(agent.id);
      await harness.manager.flush();
      expect(reloaded.activeSubagents).toBe(2);
      expect(harness.manager.getAgent(agent.id)?.activeSubagents).toBe(2);
      expect((await harness.storage.get(agent.id))?.activeSubagents).toBe(2);
    } finally {
      harness.cleanup();
    }
  });
});
