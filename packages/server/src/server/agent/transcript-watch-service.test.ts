import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

/** omp's session header row; `parentSession` is what `omp resume` writes. */
function ompHeader(id: string, cwd: string, parentSession?: string): string {
  return `${JSON.stringify({
    type: "session",
    id,
    cwd,
    timestamp: "2026-09-30T00:00:00.000Z",
    ...(parentSession ? { parentSession } : {}),
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
  /** The transcript's own directory: resume children are written next to it. */
  dir: string;
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
    /**
     * B8-WATCH (F28): resume-chain walk interval. Tests that exercise the migration
     * want it ungated (0); the one test pinning the COST of the walk overrides it
     * with the production default.
     */
    chainFollowIntervalMs?: number;
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
    chainFollowIntervalMs: input.chainFollowIntervalMs ?? 0,
    listCandidates: input.candidates ?? (async () => [candidate]),
    onChange: recorder.push,
    onAttached: input.onAttached,
  });
  services.push(service);
  return { file, dir: dirname(file), recorder, service, candidate };
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

// ---------------------------------------------------------------------------
// B8-WATCH (batch-8 F28): the watcher follows the resume chain FORWARD.
// `omp resume` never appends to the transcript it resumes from — it forks the
// conversation into a newer file in the same directory whose header names the old
// one. Tailing the file the persistence handle points at is what left a session the
// user was actively continuing looking dead: no 「外部」, no preview movement.
// ---------------------------------------------------------------------------

/** A resume child, written where omp writes it: next to its parent. */
function resumeChild(harness: Harness, name: string, parent: string, rows: string): string {
  const file = join(harness.dir, name);
  writeFileSync(file, `${ompHeader(name, work, parent)}${rows}`);
  return file;
}

const PARENT = `${ompHeader("2026-09-30_uuid.jsonl", work)}${ompLine("user", "from paseo", "p1")}`;

describe("resume chain migration (B8-WATCH, F28)", () => {
  it("follows an external resume into the child transcript and reports its rows", async () => {
    const harness = createHarness({ maxWatchers: 0, transcript: PARENT });
    await harness.service.attach(harness.candidate);
    expect(harness.recorder.changes).toEqual([]);

    const rows = `${ompLine("user", "continued", "u2")}${ompLine("assistant", "still going", "a2")}`;
    const child = resumeChild(harness, "2026-10-01_child.jsonl", harness.file, rows);

    await harness.service.sweep();

    const [change] = await harness.recorder.waitFor(1);
    expect(change.transcriptPath).toBe(child);
    expect(change.items).toEqual([
      { type: "user_message", text: "continued", messageId: "u2" },
      { type: "assistant_message", text: "still going", messageId: "a2" },
    ]);
    // The resumed file is foreign work end to end: paseo wrote nothing to it, so
    // the cursor is the parent's size plus the child's, not a fresh baseline.
    expect(change.baselineBytes).toBe(Buffer.byteLength(PARENT) + statSync(child).size);
  });

  it("keeps one cumulative baseline across the migration instead of re-baselining", async () => {
    const harness = createHarness({ maxWatchers: 0, transcript: PARENT });
    await harness.service.attach(harness.candidate);
    const child = resumeChild(
      harness,
      "2026-10-01_child.jsonl",
      harness.file,
      ompLine("user", "continued", "u2"),
    );
    await harness.service.sweep();
    const [migrated] = await harness.recorder.waitFor(1);

    // The terminal keeps writing after the migration.
    const next = ompLine("assistant", "and again", "a3");
    appendFileSync(child, next);
    await harness.service.sweep();

    const [change] = harness.recorder.changes.slice(1);
    // Continuity, both directions: the parent's bytes are not replayed, and the
    // child's already-reported rows are not swallowed by a reset baseline — the
    // cursor moved by exactly the new row.
    expect(change.items).toEqual([
      { type: "assistant_message", text: "and again", messageId: "a3" },
    ]);
    expect(change.baselineBytes - migrated.baselineBytes).toBe(Buffer.byteLength(next));
  });

  it("moves the OS watcher onto the child so later rows arrive without a sweep", async () => {
    const harness = createHarness({ transcript: PARENT });
    await harness.service.attach(harness.candidate);
    const child = resumeChild(
      harness,
      "2026-10-01_child.jsonl",
      harness.file,
      ompLine("user", "continued", "u2"),
    );
    await harness.service.sweep();
    await harness.recorder.waitFor(1);

    appendFileSync(child, ompLine("assistant", "fast path", "a8"));

    const changes = await harness.recorder.waitFor(2);
    expect(changes.at(-1)?.transcriptPath).toBe(child);
    expect(changes.at(-1)?.items).toEqual([
      { type: "assistant_message", text: "fast path", messageId: "a8" },
    ]);
  }, 10_000);

  it("tails the chain leaf after a daemon restart without replaying it", async () => {
    const harness = createHarness({ maxWatchers: 0, transcript: PARENT });
    const child = resumeChild(
      harness,
      "2026-10-01_child.jsonl",
      harness.file,
      ompLine("user", "continued", "u2"),
    );

    // What the previous daemon life persisted is a CUMULATIVE chain count, and the
    // handle still names the parent: the restart must land on the leaf and treat
    // everything up to it as already digested.
    const attached = await harness.service.attach({
      ...harness.candidate,
      baselineBytes: Buffer.byteLength(PARENT) + statSync(child).size,
    });
    expect(attached?.transcriptPath).toBe(child);
    expect(attached?.baselineBytes).toBe(Buffer.byteLength(PARENT) + statSync(child).size);
    expect(harness.recorder.changes).toEqual([]);

    appendFileSync(child, ompLine("assistant", "after restart", "a4"));
    await harness.service.sweep();
    const [change] = await harness.recorder.waitFor(1);
    expect(change.items).toEqual([
      { type: "assistant_message", text: "after restart", messageId: "a4" },
    ]);
  });

  it("does not swallow a resume that landed while no daemon was watching", async () => {
    const harness = createHarness({
      maxWatchers: 0,
      transcript: PARENT,
      // The cursor the pre-restart life left behind, for the PARENT file.
      baselineBytes: Buffer.byteLength(PARENT),
    });
    const child = resumeChild(
      harness,
      "2026-10-01_child.jsonl",
      harness.file,
      ompLine("user", "wrote while down", "u5"),
    );

    const attached = await harness.service.attach(harness.candidate);
    expect(attached?.transcriptPath).toBe(child);
    const [change] = await harness.recorder.waitFor(1);
    expect(change.items).toEqual([
      { type: "user_message", text: "wrote while down", messageId: "u5" },
    ]);
  });

  it("leaves the observation alone when nothing resumes from it", async () => {
    const harness = createHarness({ maxWatchers: 0, transcript: PARENT });
    await harness.service.attach(harness.candidate);
    // Same directory, no `parentSession`: a different conversation, not a fork.
    writeFileSync(
      join(harness.dir, "2026-10-01_sibling.jsonl"),
      `${ompHeader("2026-10-01_sibling.jsonl", work)}${ompLine("user", "different session", "d1")}`,
    );

    await harness.service.sweep();
    expect(harness.recorder.changes).toEqual([]);

    appendFileSync(harness.file, ompLine("assistant", "still mine", "a6"));
    await harness.service.sweep();
    const [change] = await harness.recorder.waitFor(1);
    expect(change.transcriptPath).toBe(harness.file);
    expect(change.items).toEqual([
      { type: "assistant_message", text: "still mine", messageId: "a6" },
    ]);
  });

  it("gates the chain walk instead of scanning the directory every check", async () => {
    // The walk costs a readdir plus bounded header reads, so it is earned, not
    // paid per tick: even for an entry whose writer just went quiet, the chase
    // cadence keeps two walks apart, and nothing about the observation breaks.
    const harness = createHarness({
      maxWatchers: 0,
      transcript: PARENT,
      chainFollowIntervalMs: 5 * 60_000,
    });
    await harness.service.attach(harness.candidate);
    appendFileSync(harness.file, ompLine("user", "external turn", "u7"));
    await harness.service.sweep();
    await harness.recorder.waitFor(1);

    resumeChild(
      harness,
      "2026-10-01_child.jsonl",
      harness.file,
      ompLine("assistant", "elsewhere", "a7"),
    );
    await harness.service.sweep();
    await harness.service.sweep();

    expect(harness.recorder.changes).toHaveLength(1);
    expect(harness.recorder.changes[0].transcriptPath).toBe(harness.file);
  });

  it("keeps chasing a fork after an empty walk instead of waiting out the interval", async () => {
    // The cadence bug this pins: a walk that finds no child must not spend the
    // whole re-check interval. `omp resume` lands seconds-to-minutes after the
    // parent goes quiet, so an entry that was written inside the freshness window
    // keeps re-walking at the chase cadence — otherwise the F28 case is followed up
    // to five minutes late, which is indistinguishable from not followed at all.
    vi.useFakeTimers();
    try {
      const harness = createHarness({
        maxWatchers: 0,
        transcript: PARENT,
        chainFollowIntervalMs: 5 * 60_000,
      });
      await harness.service.attach(harness.candidate);
      appendFileSync(harness.file, ompLine("user", "external turn", "u8"));
      await harness.service.sweep();
      expect(harness.recorder.changes).toHaveLength(1);

      vi.advanceTimersByTime(31_000);
      await harness.service.sweep();
      expect(harness.recorder.changes).toHaveLength(1);

      resumeChild(
        harness,
        "2026-10-01_child.jsonl",
        harness.file,
        ompLine("assistant", "late fork", "a9"),
      );
      vi.advanceTimersByTime(31_000);
      await harness.service.sweep();

      expect(harness.recorder.changes).toHaveLength(2);
      expect(harness.recorder.changes[1].items).toEqual([
        { type: "assistant_message", text: "late fork", messageId: "a9" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// B9-WATCH3 (F28-KI1 follow-up): the chase must survive a FLOODED transcript
// directory. The production shape: the user resumes the session, then dozens of
// subagent / new-session transcripts land next to it, all NEWER than the resumed
// child. With the 24-header window the child sat outside every chase tick and the
// observation stayed on the corpse. Fix: the window is 200 with stop-on-hit, and
// the entry's tailed path doubles as the chain-tail memory — once a hit lands,
// the next chase considers only siblings newer than the remembered tail, so the
// flood growing further cannot drop the chain.
// ---------------------------------------------------------------------------

describe("resume chain chase in a flooded directory (B9-WATCH3)", () => {
  /** An unrelated session in the same directory: pure window pressure. */
  function floodTranscript(harness: Harness, index: number, mtimeMs: number): string {
    const name = `2026-10-01_flood-${String(index).padStart(3, "0")}.jsonl`;
    const file = join(harness.dir, name);
    writeFileSync(
      file,
      `${ompHeader(name, work)}${ompLine("user", "different session", `f${index}`)}`,
    );
    utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
    return file;
  }

  it("follows the real child through 30 newer unrelated transcripts, then keeps following the chain", async () => {
    const harness = createHarness({ maxWatchers: 0, transcript: PARENT });
    await harness.service.attach(harness.candidate);

    // Deterministic mtime order: parent < child < flood #1 < grandchild < flood #2.
    const base = Date.now() - 60 * 60_000;
    utimesSync(harness.file, new Date(base), new Date(base));
    const child = resumeChild(
      harness,
      "2026-10-01_child.jsonl",
      harness.file,
      ompLine("user", "continued", "u11"),
    );
    utimesSync(child, new Date(base + 60_000), new Date(base + 60_000));
    for (let index = 0; index < 30; index += 1) {
      floodTranscript(harness, index, base + 120_000 + index * 1_000);
    }

    await harness.service.sweep();
    const [migration] = await harness.recorder.waitFor(1);
    expect(migration.transcriptPath).toBe(child);
    expect(migration.items).toEqual([
      { type: "user_message", text: "continued", messageId: "u11" },
    ]);

    // The entry now remembers `child` as the chain tail. The flood keeps growing
    // and a grandchild resumes from the child — the chase follows to the
    // grandchild instead of dropping off the chain.
    const grand = resumeChild(
      harness,
      "2026-10-01_grand.jsonl",
      child,
      ompLine("assistant", "third link", "a11"),
    );
    utimesSync(grand, new Date(base + 30 * 60_000), new Date(base + 30 * 60_000));
    for (let index = 30; index < 60; index += 1) {
      floodTranscript(harness, index, base + 40 * 60_000 + index * 1_000);
    }

    await harness.service.sweep();
    const changes = await harness.recorder.waitFor(2);
    expect(changes.at(-1)?.transcriptPath).toBe(grand);
    expect(changes.at(-1)?.items).toEqual([
      { type: "assistant_message", text: "third link", messageId: "a11" },
    ]);
  });
});
