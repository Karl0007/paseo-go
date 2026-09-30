import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentPersistenceHandle, AgentProvider } from "./agent-sdk-types.js";
import {
  TranscriptWatchService,
  type TranscriptChange,
  type TranscriptWatchCandidate,
} from "./transcript-watch-service.js";

// B4-OWNERSHIP (batch-4 F8, R3): the transcript watcher against real files in a
// temp dir — the "user continued the session in their own terminal" scenarios from
// RESEARCH-provider-dual-write.md, observed the way the daemon observes them: bytes
// appended to the provider's own transcript.
//
// Time is driven, not slept: every test either awaits the change the service
// reports (the real signal) or runs with `maxWatchers: 0` so the only possible
// detector is a `sweep()` the test calls itself. The one exception is the watcher
// fast-path test, which exists precisely to prove the OS watcher fires; it awaits
// the callback rather than a duration.

const OMP_PROVIDER: AgentProvider = "omp";

function ompLine(role: "user" | "assistant", text: string, id: string): string {
  return `${JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-30T00:00:00.000Z",
    message: { role, content: [{ type: "text", text }] },
  })}\n`;
}

/** Resolves once `count` changes have arrived; never guesses a duration. */
class ChangeRecorder {
  readonly changes: TranscriptChange[] = [];
  private waiters: { count: number; resolve: () => void }[] = [];

  push = async (change: TranscriptChange): Promise<void> => {
    this.changes.push(change);
    for (const waiter of this.waiters.filter((entry) => entry.count <= this.changes.length)) {
      waiter.resolve();
    }
    this.waiters = this.waiters.filter((entry) => entry.count > this.changes.length);
  };

  waitFor(count: number): Promise<TranscriptChange[]> {
    if (this.changes.length >= count) {
      return Promise.resolve(this.changes);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    this.waiters.push({ count, resolve });
    return promise.then(() => this.changes);
  }
}

let work = "";
const services: TranscriptWatchService[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "transcript-watch-"));
});

afterEach(() => {
  for (const service of services.splice(0)) {
    service.stop();
  }
  rmSync(work, { recursive: true, force: true });
});

interface Harness {
  file: string;
  recorder: ChangeRecorder;
  service: TranscriptWatchService;
  candidate: TranscriptWatchCandidate;
}

function createHarness(
  input: {
    provider?: AgentProvider;
    transcript?: string;
    baselineBytes?: number | null;
    maxWatchers?: number;
    candidates?: () => Promise<TranscriptWatchCandidate[]>;
  } = {},
): Harness {
  const file = join(work, "sessions", "--proj--", "2026-09-30_uuid.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, input.transcript ?? ompLine("user", "from paseo", "p1"));

  const provider = input.provider ?? OMP_PROVIDER;
  const persistence: AgentPersistenceHandle = {
    provider,
    sessionId: "uuid",
    nativeHandle: file,
  };
  const candidate: TranscriptWatchCandidate = {
    agentId: "agent-1",
    provider,
    persistence,
    cwd: work,
    baselineBytes: input.baselineBytes ?? null,
    updatedAtMs: Date.now(),
  };
  const recorder = new ChangeRecorder();
  const service = new TranscriptWatchService({
    logger: createTestLogger(),
    // Long enough that no interval can fire inside a test; sweeps are explicit.
    statPollIntervalMs: 60 * 60 * 1000,
    maxWatchers: input.maxWatchers ?? 8,
    listCandidates: input.candidates ?? (async () => [candidate]),
    onChange: recorder.push,
  });
  services.push(service);
  return { file, recorder, service, candidate };
}

describe("TranscriptWatchService.attach", () => {
  it("resolves the provider transcript and baselines without reporting history", async () => {
    const harness = createHarness();
    const attached = await harness.service.attach(harness.candidate);

    const ownBytes = Buffer.byteLength(ompLine("user", "from paseo", "p1"));
    expect(attached).toEqual({ transcriptPath: harness.file, baselineBytes: ownBytes });
    // The rows already in the file are paseo's own work — not evidence of a stranger.
    expect(harness.recorder.changes).toEqual([]);
    expect(harness.service.watchedAgentIds).toEqual(["agent-1"]);
  });

  it("never attaches a provider whose transcript it cannot locate", async () => {
    // Card rule: no transcript knowledge ⇒ the provider can never be `external`.
    const harness = createHarness({ provider: "opencode" });
    await expect(harness.service.attach(harness.candidate)).resolves.toBeNull();
    expect(harness.service.watchedAgentIds).toEqual([]);
  });

  it("resumes from the persisted cursor so growth during a restart is still visible", async () => {
    const first = ompLine("user", "one", "1");
    const harness = createHarness({ transcript: first, baselineBytes: Buffer.byteLength(first) });
    // The daemon died; meanwhile the user kept going in their terminal.
    appendFileSync(harness.file, ompLine("assistant", "two", "2"));

    const attached = await harness.service.attach(harness.candidate);
    expect(attached?.baselineBytes).toBe(
      Buffer.byteLength(first + ompLine("assistant", "two", "2")),
    );

    const [change] = await harness.recorder.waitFor(1);
    expect(change.items).toEqual([{ type: "assistant_message", text: "two", messageId: "2" }]);
    expect(change.agentId).toBe("agent-1");
  });
});

describe("external writes on a released session", () => {
  it("reports a continued conversation through the OS watcher", async () => {
    const harness = createHarness();
    await harness.service.attach(harness.candidate);

    // `omp -r` in another terminal: a user turn, then the assistant's reply.
    appendFileSync(harness.file, ompLine("user", "keep going", "u2"));
    appendFileSync(harness.file, ompLine("assistant", "done", "a2"));

    const changes = await harness.recorder.waitFor(1);
    const merged = changes.flatMap((change) => change.items);
    expect(merged).toContainEqual({ type: "user_message", text: "keep going", messageId: "u2" });
    expect(changes.at(-1)?.baselineBytes).toBe(
      Buffer.byteLength(
        ompLine("user", "from paseo", "p1") +
          ompLine("user", "keep going", "u2") +
          ompLine("assistant", "done", "a2"),
      ),
    );
  }, 10_000);

  it("waits for a torn line instead of parsing half a row", async () => {
    const harness = createHarness({ maxWatchers: 0 });
    await harness.service.attach(harness.candidate);
    const whole = ompLine("assistant", "whole", "a10");
    const torn = whole.slice(0, 40);

    appendFileSync(harness.file, torn);
    await harness.service.sweep();
    // Bytes moved, so the caller learns the session is foreign — but a half row is
    // never garbled into a message, and the cursor stays put.
    expect(harness.recorder.changes.flatMap((change) => change.items)).toEqual([]);
    expect(harness.recorder.changes.at(-1)?.baselineBytes).toBe(
      Buffer.byteLength(ompLine("user", "from paseo", "p1")),
    );

    appendFileSync(harness.file, whole.slice(40));
    await harness.service.sweep();
    const changes = await harness.recorder.waitFor(2);
    expect(changes.at(-1)?.items).toEqual([
      { type: "assistant_message", text: "whole", messageId: "a10" },
    ]);
    expect(changes.at(-1)?.baselineBytes).toBe(
      Buffer.byteLength(ompLine("user", "from paseo", "p1") + whole),
    );
  });

  it("catches what the watcher misses through the stat sweep", async () => {
    // maxWatchers: 0 leaves polling as the only detector — the guarantee on network
    // mounts and after a silently-dead Windows watcher.
    const harness = createHarness({ maxWatchers: 0 });
    await harness.service.attach(harness.candidate);

    appendFileSync(harness.file, ompLine("assistant", "via poll", "a3"));
    await harness.service.sweep();

    const [change] = await harness.recorder.waitFor(1);
    expect(change.items).toEqual([
      { type: "assistant_message", text: "via poll", messageId: "a3" },
    ]);
  });

  it("treats a rewritten (shrunk) transcript as foreign work", async () => {
    const harness = createHarness({
      maxWatchers: 0,
      transcript: `${ompLine("user", "one", "1")}${ompLine("assistant", "two", "2")}`,
    });
    await harness.service.attach(harness.candidate);

    // omp/pi self-repair their journal by truncating torn lines and re-appending.
    const rewritten = ompLine("user", "rewritten", "3");
    writeFileSync(harness.file, rewritten);
    await harness.service.sweep();

    const [change] = await harness.recorder.waitFor(1);
    expect(change.items).toEqual([{ type: "user_message", text: "rewritten", messageId: "3" }]);
    expect(change.baselineBytes).toBe(Buffer.byteLength(rewritten));
  });

  it("reports a change even when no row maps to a visible message", async () => {
    const harness = createHarness({ maxWatchers: 0 });
    await harness.service.attach(harness.candidate);

    appendFileSync(harness.file, `${JSON.stringify({ type: "title_change", id: "t" })}\n`);
    await harness.service.sweep();

    const [change] = await harness.recorder.waitFor(1);
    // Bytes moved, nothing to show: the caller still escalates ownership.
    expect(change.items).toEqual([]);
    expect(change.baselineBytes).toBeGreaterThan(0);
  });
});

describe("sweep lifecycle", () => {
  it("discovers agents the manager reports and drops the ones that leave", async () => {
    let candidates: TranscriptWatchCandidate[] = [];
    const harness = createHarness({ candidates: async () => candidates });
    harness.service.start();
    candidates = [harness.candidate];

    await harness.service.sweep();
    expect(harness.service.watchedAgentIds).toEqual(["agent-1"]);

    candidates = [];
    await harness.service.sweep();
    expect(harness.service.watchedAgentIds).toEqual([]);
  });

  it("reports nothing once detached — paseo took the session back", async () => {
    const harness = createHarness({ maxWatchers: 0, candidates: async () => [] });
    await harness.service.attach(harness.candidate);
    harness.service.detach("agent-1");

    appendFileSync(harness.file, ompLine("user", "mine now", "u4"));
    await harness.service.sweep();
    expect(harness.recorder.changes).toEqual([]);
    expect(harness.service.watchedAgentIds).toEqual([]);
  });

  it("stops after shutdown so no write lands past the snapshot flush", async () => {
    const harness = createHarness({ maxWatchers: 0 });
    await harness.service.attach(harness.candidate);
    harness.service.stop();

    expect(harness.service.isStopped).toBe(true);
    appendFileSync(harness.file, ompLine("user", "too late", "u5"));
    await harness.service.sweep();
    expect(harness.recorder.changes).toEqual([]);
    await expect(
      harness.service.attach({ ...harness.candidate, agentId: "agent-2" }),
    ).resolves.toBeNull();
  });
});
