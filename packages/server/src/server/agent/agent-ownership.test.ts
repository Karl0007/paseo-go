import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { buildStoredAgentPayload, toAgentPayload } from "./agent-projections.js";
import type { AgentPersistenceHandle } from "./agent-sdk-types.js";
import { claudeProjectDirSync } from "./providers/claude/project-dir.js";
import {
  INITIAL_AGENT_OWNERSHIP,
  deriveAgentOwnershipValue,
  ownershipOnAcquire,
  ownershipOnExternalChange,
  ownershipOnRelease,
  ownershipWithExternalActivity,
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
