import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentPersistenceHandle, AgentProvider } from "./agent-sdk-types.js";
import type { ProviderTranscriptInput } from "./provider-transcript.js";
import {
  TranscriptWatchService,
  type TranscriptAttachment,
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

// B6-REVIEW (RevB6 finding 1): the discovery memory set promises that a doomed
// transcript resolution is paid ONCE per queued candidate. From the outside that is
// invisible — `attach()` answers null either way — so resolution is spied on with a
// passthrough (the session.test.ts pattern): behaviour untouched, calls countable.
const resolveAttempts: string[] = [];

vi.mock("./provider-transcript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider-transcript.js")>();
  return {
    ...actual,
    resolveProviderTranscriptPath: async (input: ProviderTranscriptInput) => {
      resolveAttempts.push(input.persistence?.nativeHandle ?? `${input.provider}:<none>`);
      return actual.resolveProviderTranscriptPath(input);
    },
  };
});

/** How many passes tried to locate this candidate's transcript. */
function resolutionAttemptsFor(candidate: TranscriptWatchCandidate): number {
  const handle = candidate.persistence?.nativeHandle;
  if (!handle) {
    return 0;
  }
  return resolveAttempts.filter((attempt) => attempt === handle).length;
}

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
    onAttached?: (agentId: string, attachment: TranscriptAttachment) => Promise<void>;
    /** B6-OWN-HEAL: discovery batch size; the tests pin the cap explicitly. */
    maxNewAttachmentsPerSweep?: number;
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
    maxNewAttachmentsPerSweep: input.maxNewAttachmentsPerSweep,
    // No inter-attach gap: these tests assert the batch, not the wall clock.
    attachThrottleMs: 0,
    listCandidates: input.candidates ?? (async () => [candidate]),
    onChange: recorder.push,
    onAttached: input.onAttached,
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

// ---------------------------------------------------------------------------
// B6-OWN-HEAL (batch-6 F19/D22): the startup discovery batch. A daemon restart
// leaves every stored agent unobserved, and the pill used to sit on 「未知」 until
// the first interval tick (60s) — or forever, for agents nobody ever opened. The
// batch is what makes the list answer by itself: immediate, capped, throttled,
// and never fatal (B5-REVIEW S2: a read failure may not cost anything else).
// ---------------------------------------------------------------------------

describe("startup discovery batch (B6-OWN-HEAL)", () => {
  /** A stored agent with its own transcript on disk, at the given activity time. */
  function storedAgent(
    agentId: string,
    updatedAtMs: number,
    provider: AgentProvider = OMP_PROVIDER,
  ): TranscriptWatchCandidate {
    const file = join(work, "sessions", `${agentId}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, ompLine("user", `born in ${agentId}`, agentId));
    return {
      agentId,
      provider,
      persistence: { provider, sessionId: agentId, nativeHandle: file },
      cwd: work,
      baselineBytes: null,
      updatedAtMs,
    };
  }

  it("discovers the stored agents at start(), not one stat interval later", async () => {
    // The harness interval is an hour, so anything observed here came from `start()`.
    const handed: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const harness = createHarness({
      onAttached: async (agentId) => {
        handed.push(agentId);
        resolve();
      },
    });
    harness.service.start();
    await promise;
    expect(handed).toEqual(["agent-1"]);
  });

  it("attaches this pass's cap newest-first and finishes the rest on the next pass", async () => {
    const older = storedAgent("agent-old", Date.now() - 60_000);
    const middle = storedAgent("agent-mid", Date.now() - 30_000);
    const newest = storedAgent("agent-new", Date.now());
    const harness = createHarness({
      candidates: async () => [older, middle, newest],
      maxNewAttachmentsPerSweep: 2,
    });

    await harness.service.sweep();
    // The rows the user is looking at heal first; the batch stays bounded.
    expect(harness.service.watchedAgentIds).toEqual(["agent-new", "agent-mid"]);

    await harness.service.sweep();
    expect(harness.service.watchedAgentIds).toEqual(["agent-new", "agent-mid", "agent-old"]);
  });

  it("skips a candidate whose transcript it cannot locate and still watches the rest", async () => {
    const blind = storedAgent("agent-blind", Date.now(), "opencode");
    const observable = storedAgent("agent-seen", Date.now() - 1_000);
    const harness = createHarness({ candidates: async () => [blind, observable] });

    await harness.service.sweep();
    expect(harness.service.watchedAgentIds).toEqual(["agent-seen"]);
  });

  it("does not let unresolvable candidates starve the sessions behind them", async () => {
    // RevB6 finding 1: the cap counted *attempts*, so a wall of candidates whose
    // transcript cannot be resolved (opencode has no transcript file by design, a
    // deleted claude worktree, a stale omp handle) retook the newest-N window on
    // every pass and the observable rows behind them were never watched — the
    // live-writer axis stayed dead for exactly the sessions this batch heals.
    const blind = Array.from({ length: 5 }, (_, index) =>
      storedAgent(`agent-blind-${index}`, Date.now() - index, "opencode"),
    );
    const observable = [
      storedAgent("agent-seen-A", Date.now() - 1_000),
      storedAgent("agent-seen-B", Date.now() - 2_000),
    ];
    const harness = createHarness({
      candidates: async () => [...blind, ...observable],
      maxNewAttachmentsPerSweep: 2,
    });

    for (let pass = 0; pass < 4; pass += 1) {
      await harness.service.sweep();
    }
    expect(harness.service.watchedAgentIds).toEqual(["agent-seen-A", "agent-seen-B"]);
  });

  it("pays a doomed transcript resolution once instead of every pass", async () => {
    const blind = storedAgent("agent-blind-once", Date.now(), "opencode");
    const harness = createHarness({ candidates: async () => [blind] });

    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(1);

    // Pre-fix every pass re-resolved the same doomed batch — ~775ms of attach
    // throttle per minute, forever, for candidates that can never resolve.
    await harness.service.sweep();
    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(1);
  });

  it("bounds one pass's scan even when nothing resolves", async () => {
    const blind = Array.from({ length: 10 }, (_, index) =>
      storedAgent(`agent-blind-cap-${index}`, Date.now() - index, "opencode"),
    );
    const harness = createHarness({
      candidates: async () => blind,
      maxNewAttachmentsPerSweep: 2,
    });

    // Success budget 2 ⇒ attempt budget 4 (2×): a pass may not walk the whole store
    // hunting for winners, yet it still advances, because every doomed row is tried
    // exactly once ever. Three passes cover ten.
    const before = resolveAttempts.length;
    await harness.service.sweep();
    expect(resolveAttempts.length - before).toBe(4);

    for (let pass = 0; pass < 3; pass += 1) {
      await harness.service.sweep();
    }
    expect(resolveAttempts.length - before).toBe(10);
  });

  it("forgets a candidate that left the queue — its transcript may exist by now", async () => {
    let listed = true;
    const blind = storedAgent("agent-blind-return", Date.now(), "opencode");
    const harness = createHarness({ candidates: async () => (listed ? [blind] : []) });

    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(1);

    // Out of the store (or out of the retention window) ⇒ the negative answer is
    // dropped, so a session resumed later gets a fresh discovery attempt.
    listed = false;
    await harness.service.sweep();
    listed = true;
    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(2);
  });

  it("forgets a candidate on detach", async () => {
    const blind = storedAgent("agent-blind-detach", Date.now(), "opencode");
    const harness = createHarness({ candidates: async () => [blind] });

    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(1);

    // Detaching forgets the negative answer — the path may exist by the next pass.
    harness.service.detach("agent-blind-detach");
    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(2);

    // ...and the fresh answer is remembered again, not retried every pass.
    await harness.service.sweep();
    expect(resolutionAttemptsFor(blind)).toBe(2);
  });

  it("survives one candidate's failed handoff instead of aborting the batch", async () => {
    const failing = storedAgent("agent-a", Date.now());
    const healthy = storedAgent("agent-b", Date.now() - 1_000);
    const harness = createHarness({
      candidates: async () => [failing, healthy],
      onAttached: async (agentId) => {
        if (agentId === "agent-a") {
          throw new Error("storage write failed");
        }
      },
    });

    // Pre-fix the throw escaped the loop and the whole sweep — including every
    // later candidate and every stat check — was skipped for that tick.
    await expect(harness.service.sweep()).resolves.toBeUndefined();
    expect(harness.service.watchedAgentIds).toEqual(["agent-a", "agent-b"]);
    expect(harness.recorder.changes).toEqual([]);
  });
});

describe("discovery attach baseline handoff (R4-03)", () => {
  it("hands the sweep's freshly established baseline to the caller for persistence", async () => {
    const first = ompLine("user", "one", "1");
    const handed: { agentId: string; baselineBytes: number | null }[] = [];
    const harness = createHarness({
      transcript: first,
      onAttached: async (agentId, attachment) => {
        handed.push({ agentId, baselineBytes: attachment.baselineBytes });
      },
    });
    // Discovery attach with no persisted cursor: the baseline it establishes
    // must reach the caller — dropped on the floor, every restart would
    // re-baseline over the bytes written while the daemon was down.
    await harness.service.sweep();
    expect(handed).toEqual([{ agentId: "agent-1", baselineBytes: Buffer.byteLength(first) }]);

    // Already-tracked entries do not re-hand on every sweep.
    handed.length = 0;
    await harness.service.sweep();
    expect(handed).toEqual([]);
  });

  it("does not fire for a direct attach — the release path persists what it learned", async () => {
    const handed: string[] = [];
    const harness = createHarness({
      onAttached: async (agentId) => {
        handed.push(agentId);
      },
    });
    await harness.service.attach(harness.candidate);
    expect(handed).toEqual([]);
  });
});

describe("watcher slot fairness (R4-22)", () => {
  it("gives the slot to a fresh release and keeps the demoted entry on the sweep", async () => {
    const harness = createHarness({ maxWatchers: 1 });
    const fileB = join(work, "sessions", "b.jsonl");
    writeFileSync(fileB, ompLine("user", "second session", "s0"));
    await harness.service.attach(harness.candidate);
    expect(harness.service.fastPathAgentIds).toEqual(["agent-1"]);

    await harness.service.attach({
      ...harness.candidate,
      agentId: "agent-2",
      persistence: { provider: OMP_PROVIDER, sessionId: "b", nativeHandle: fileB },
    });
    // Insertion order used to mean the NEWEST release starves on the 60s slow
    // path forever once the cap is full. LRU: the newcomer (most recent
    // activity by definition) takes the slot; the older holder steps down to
    // the stat sweep with its entry and cursor intact.
    expect(harness.service.fastPathAgentIds).toEqual(["agent-2"]);
    expect(harness.service.watchedAgentIds).toEqual(["agent-1", "agent-2"]);

    appendFileSync(harness.file, ompLine("assistant", "still detected", "s2"));
    await harness.service.sweep();
    const [change] = await harness.recorder.waitFor(1);
    expect(change.agentId).toBe("agent-1");
    expect(change.items).toEqual([
      { type: "assistant_message", text: "still detected", messageId: "s2" },
    ]);
  });
});

describe("tail read bound (R4-23)", () => {
  it("digests a burst beyond the cap across checks instead of one unbounded read", async () => {
    const base = ompLine("user", "from paseo", "p1");
    const harness = createHarness({
      maxWatchers: 0,
      baselineBytes: Buffer.byteLength(base),
    });
    const line = (index: number) =>
      ompLine("user", `burst ${index} ${"x".repeat(2048)}`, `b${index}`);
    const count = 2_200; // ≈ 4.7 MB appended at once — past the 4 MiB cap
    const burst = Array.from({ length: count }, (_, index) => line(index)).join("");
    expect(Buffer.byteLength(burst)).toBeGreaterThan(4 * 1024 * 1024);
    const baseBytes = Buffer.byteLength(base);
    appendFileSync(harness.file, burst);

    await harness.service.sweep();
    // Pre-fix the whole 4.7 MB burst came back as ONE change with ONE buffer
    // read. Now every reported cursor step stays under the cap...
    let previous = baseBytes;
    for (const change of harness.recorder.changes) {
      expect(change.baselineBytes - previous).toBeLessThanOrEqual(4 * 1024 * 1024);
      previous = change.baselineBytes;
    }
    expect(harness.recorder.changes[0].items.length).toBeLessThan(count);
    // ...and the digest across checks loses nothing.
    const total = harness.recorder.changes.reduce((sum, change) => sum + change.items.length, 0);
    expect(total).toBe(count);
    await harness.service.sweep();
    expect(harness.recorder.changes.reduce((sum, change) => sum + change.items.length, 0)).toBe(
      count,
    );
  }, 20_000);
});
