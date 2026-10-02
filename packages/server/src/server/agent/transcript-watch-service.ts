import { watch } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

import type {
  AgentPersistenceHandle,
  AgentProvider,
  AgentTimelineItem,
} from "./agent-sdk-types.js";
import {
  LOOKS_ACTIVE_MTIME_WINDOW_MS,
  mapProviderTranscriptLines,
  resolveProviderTranscriptPath,
  statTranscriptBytes,
} from "./provider-transcript.js";
import { probeExternalTranscriptActivity } from "./transcript-activity-probe.js";
import { resolveOmpResumeLeafChain, sessionPathKey } from "./providers/omp/session-descriptor.js";

/**
 * Paseo Go B4-OWNERSHIP (batch-4 F8, R3 + R2-lite): the transcript watcher.
 *
 * A session paseo is NOT running can still be written by the user's own terminal
 * (`omp -r`, `claude --resume`, `codex resume`, …). This service is how the daemon
 * finds out, and it is the only place that may escalate ownership to `external`.
 *
 * Two detection layers, because neither is sufficient alone:
 * 1. `fs.watch` on the transcript file, debounced — sub-second reaction for the
 *    common local-disk case. Windows watchers die silently and events coalesce, so
 *    a watcher is an optimisation, never the guarantee.
 * 2. A single `stat`(size)-based sweep over every attached transcript, on a fixed
 *    interval (config `agents.transcriptStatPollIntervalMs`, default 60s) — the
 *    fallback for lost events, dead watchers, and network mounts where fs.watch
 *    reports nothing at all.
 *
 * On a detected change the service reads ONLY the newly appended bytes, drops a
 * trailing partial line (providers append line-wise, so a half line is a torn
 * write), maps complete rows to timeline items through the provider mapper
 * (unknown `type` rows are skipped, never fatal — claude and omp/pi both carry
 * volatile meta rows), and reports one {@link TranscriptChange}. The service keeps
 * no agent state of its own beyond the byte cursor: the caller owns the timeline,
 * the preview chain, and the ownership state machine.
 *
 * B8-WATCH (F28): an omp session does not live in one file forever — `omp resume`
 * forks the conversation into a NEWER transcript whose header names the old one. The
 * watcher therefore observes a CHAIN (the handle's file plus every descendant it has
 * followed), tails its leaf, and counts bytes cumulatively across it, so crossing
 * into the new file neither loses the writes there nor resets the ownership baseline.
 *
 * B9-SUBACT (F31 ruling B+): an omp session's SUBAGENTS are a second tree — their
 * transcripts spawn into a directory named after the parent session
 * (`<parentStem>/<agentName>.jsonl`), which the chain cursor can never see. The
 * watch entry therefore also stats that directory on the same two-tier chase
 * cadence as the resume walk (stats only, zero header reads): children written
 * inside the freshness window are foreign work running under this session, which
 * rides out as `activeSubagents` on every change and — with no main-transcript
 * movement of its own — as a subagent-only change the caller escalates exactly
 * like F33's live-idle foreign bytes.
 */

/** Debounce window collapsing a burst of watcher events into one tail read. */
const DEFAULT_DEBOUNCE_MS = 250;
/** Fallback stat sweep; overridden by `agents.transcriptStatPollIntervalMs`. */
export const DEFAULT_TRANSCRIPT_STAT_POLL_INTERVAL_MS = 60_000;
/** Concurrent `fs.watch` handles; extra transcripts stay on the stat sweep. */
const DEFAULT_MAX_WATCHERS = 64;
/** Agents untouched for longer than this stop being watched (opening them replays history). */
const WATCH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * R4-23: upper bound on one tail read. A watcher-failure window (network mount
 * — the reason this service exists) can pile 60s of growth behind one cursor;
 * the sweep digests at most this many bytes per check and continues from the
 * aligned cursor on the next one instead of spiking the heap.
 */
const MAX_TAIL_READ_BYTES = 4 * 1024 * 1024;

/**
 * B8-WATCH (F28): the two cadences on which ONE entry may re-walk its omp resume
 * chain. A walk is a directory scan plus a bounded number of header reads (see
 * `providers/omp/session-descriptor.ts`), so it is deliberately NOT part of every
 * tick. A fork is written within seconds of the parent going quiet, so an entry that
 * is still receiving foreign bytes is chased at the fast cadence; a long-idle entry
 * (including one resumed while no daemon was running) is re-checked at the slow one.
 */
const DEFAULT_CHAIN_FOLLOW_INTERVAL_MS = 5 * 60_000;
const CHAIN_FOLLOW_CHASE_INTERVAL_MS = 30_000;
/**
 * B6-OWN-HEAL (batch-6 F19/D22): how many not-yet-observed transcripts ONE discovery
 * pass may attach. The startup sweep is the first real caller of discovery, and a
 * store with hundreds of agents must not turn a daemon boot into hundreds of
 * sequential path resolutions + stats in a single tick; the remainder is picked up by
 * the following sweeps, and every agent the user actually looks at is in the newest
 * slice (the batch is ordered by `updatedAt` desc).
 */
const DEFAULT_MAX_NEW_ATTACHMENTS_PER_SWEEP = 32;
/** B6-OWN-HEAL: gap between attaches inside one batch (slow-mount throttle). */
const DEFAULT_ATTACH_THROTTLE_MS = 25;

/**
 * B6-REVIEW (RevB6 finding 1): how many candidates one discovery pass may *try*, as a
 * multiple of the success budget. Since the cap counts successful attaches, an
 * attempt-less pass would walk a store full of unresolvable rows end to end looking
 * for winners; 2× keeps one pass bounded and still steps over a run of dead rows.
 */
const MAX_DISCOVERY_ATTEMPT_MULTIPLIER = 2;

export interface TranscriptWatchCandidate {
  agentId: string;
  provider: AgentProvider;
  persistence: AgentPersistenceHandle | null;
  cwd: string;
  /**
   * Persisted transcript cursor; null = first observation for this agent.
   * B8-WATCH (F28): cumulative across the observed resume chain, not an offset
   * inside one file — see {@link WatchEntry.cursor}.
   */
  baselineBytes: number | null;
  /** Record `updatedAt` in ms; drives {@link WATCH_RETENTION_MS}. */
  updatedAtMs: number;
}

export interface TranscriptChange {
  agentId: string;
  /** The transcript actually tailed: a resume child of the handle's file after F28. */
  transcriptPath: string;
  /** Rows the external writer appended since the cursor (empty = bytes changed, no visible message). */
  items: AgentTimelineItem[];
  /** New cursor to persist with the agent record (chain-cumulative). */
  baselineBytes: number;
  /** R4 signal: does the external writer still look alive? */
  externalLooksActive: boolean;
  /**
   * B9-SUBACT (F31 B+): child transcripts written inside the freshness window at
   * the last tree scan. Absent = the provider has no child-transcript layout (or
   * the tree has never been scanned); 0 = scanned and quiet. Subagent-only changes
   * carry it with `items: []` — the count decaying to 0 is as observable as a
   * child appearing, and the caller's badge must be able to clear.
   */
  activeSubagents?: number;
}

/** What `attach` learned: the transcript it now tails and the cursor it starts from. */
export interface TranscriptAttachment {
  /**
   * The file now tailed. Usually the handle's own transcript; after B8-WATCH (F28)
   * it is the leaf of the omp resume chain when the conversation was forked into a
   * newer file.
   */
  transcriptPath: string;
  /**
   * Byte count the cursor is now at, cumulative over the observed chain: the
   * persisted one when the caller supplied it (so growth during a daemon restart is
   * still visible) or the freshly established baseline when there was no prior
   * observation.
   */
  baselineBytes: number | null;
}

export interface TranscriptWatchServiceOptions {
  logger: Logger;
  statPollIntervalMs?: number;
  debounceMs?: number;
  maxWatchers?: number;
  /** Injectable for tests (CLAUDE_CONFIG_DIR / CODEX_HOME redirection). */
  env?: NodeJS.ProcessEnv;
  listCandidates: () => Promise<TranscriptWatchCandidate[]>;
  onChange: (change: TranscriptChange) => Promise<void>;
  /**
   * R4-03: called after a discovery attach in `sweep()` resolved a baseline the
   * candidate did not carry. The service persists nothing — the caller owns
   * storage; without this hop a first-established baseline dies with the
   * process and writes landing while the daemon is down are re-baselined away
   * on every restart.
   */
  onAttached?: (agentId: string, attachment: TranscriptAttachment) => Promise<void>;
  /** B6-OWN-HEAL: discovery cap; see {@link DEFAULT_MAX_NEW_ATTACHMENTS_PER_SWEEP}. */
  maxNewAttachmentsPerSweep?: number;
  /** B6-OWN-HEAL: discovery throttle; 0 = no gap (tests). */
  attachThrottleMs?: number;
  /**
   * B8-WATCH (F28): gap between resume-chain walks of one silent entry; 0 = walk on
   * every silent check (tests). See {@link DEFAULT_CHAIN_FOLLOW_INTERVAL_MS}.
   */
  chainFollowIntervalMs?: number;
}

interface WatchEntry {
  candidate: TranscriptWatchCandidate;
  /**
   * The transcript currently tailed: the observed provider file, or the newest
   * resume child of it (B8-WATCH, F28). B9-WATCH3: this is also the chain-tail
   * memory — attach seeds it with the cold walk and every chase hit moves it,
   * so the next chase only has to consider siblings NEWER than it.
   */
  transcriptPath: string;
  /**
   * B8-WATCH (F28): the observed resume chain, oldest first. `[transcriptPath]` for
   * a provider that keeps one file per session; `[handleFile, …, transcriptPath]`
   * once an `omp resume` has been followed.
   */
  chain: string[];
  /** Σ bytes of every `chain` file before `transcriptPath`. */
  chainBaseBytes: number;
  /**
   * Digested bytes CUMULATIVE over `chain`, never an offset inside one file. That is
   * what makes the ownership baseline continuous when the observation migrates to a
   * resume child: the prefix moves past the old leaf, the cursor does not move, so
   * the new leaf is read from byte 0 and a writer that kept going across the
   * migration still reads as continuing external activity instead of a reset.
   */
  cursor: number | null;
  watcher: FSWatcher | null;
  debounce: ReturnType<typeof setTimeout> | null;
  checking: boolean;
  /** Monotonic attach order; tie-breaks the LRU slot choice (R4-22). */
  attachSeq: number;
  /** Last time this entry's file was examined or moved (drives R4-22 LRU). */
  lastActiveMs: number;
  /** Last resume-chain walk of this entry (drives the F28 cost gate). */
  lastChainFollowMs: number;
  /** Last byte of foreign work observed (decides the chase vs periodic cadence). */
  lastGrowthMs: number;
  /**
   * B9-SUBACT: last child-tree scan of this entry (drives the same two-tier cost
   * gate as {@link lastChainFollowMs}; a scan is a readdir plus per-file stats,
   * never a header read).
   */
  lastSubagentScanMs: number;
  /**
   * B9-SUBACT: children written inside the freshness window at the last scan.
   * `undefined` = never scanned (the change omits the field); 0 = scanned quiet.
   */
  subagentCount: number | undefined;
  /** B9-SUBACT: `sessionPathKey` of the scanned child directory, null before it. */
  subagentDirKey: string | null;
  /**
   * B9-SUBACT: last scan's `sessionPathKey → mtimeMs` for every child transcript,
   * the import screen's live-overlay answer (card §5) — a child the scan never saw
   * landed after it, and the mtime estimate is the honest answer for that one.
   */
  subagentWrites: Map<string, number> | null;
}

export class TranscriptWatchService {
  private readonly logger: Logger;
  private readonly statPollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly maxWatchers: number;
  private readonly maxNewAttachmentsPerSweep: number;
  private readonly attachThrottleMs: number;
  /** B8-WATCH (F28): see {@link DEFAULT_CHAIN_FOLLOW_INTERVAL_MS}. */
  private readonly chainFollowIntervalMs: number;
  private readonly chainFollowChaseIntervalMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly listCandidates: () => Promise<TranscriptWatchCandidate[]>;
  private readonly onChange: (change: TranscriptChange) => Promise<void>;
  private readonly onAttached?: (
    agentId: string,
    attachment: TranscriptAttachment,
  ) => Promise<void>;
  private entrySeq = 0;
  private readonly entries = new Map<string, WatchEntry>();
  /**
   * B6-REVIEW: candidates whose transcript resolution came back empty. See
   * {@link discover} for why the negative answer has to be remembered, and
   * {@link detach} / {@link runSweep} for when it is forgotten.
   */
  private readonly unresolvable = new Set<string>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** The running pass, or null while idle. See {@link sweep} / {@link tick}. */
  private pass: Promise<void> | null = null;
  private stopped = false;

  constructor(options: TranscriptWatchServiceOptions) {
    this.logger = options.logger.child({ component: "transcript-watch" });
    this.statPollIntervalMs =
      options.statPollIntervalMs ?? DEFAULT_TRANSCRIPT_STAT_POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWatchers = options.maxWatchers ?? DEFAULT_MAX_WATCHERS;
    this.maxNewAttachmentsPerSweep =
      options.maxNewAttachmentsPerSweep ?? DEFAULT_MAX_NEW_ATTACHMENTS_PER_SWEEP;
    this.attachThrottleMs = options.attachThrottleMs ?? DEFAULT_ATTACH_THROTTLE_MS;
    this.chainFollowIntervalMs = options.chainFollowIntervalMs ?? DEFAULT_CHAIN_FOLLOW_INTERVAL_MS;
    // A caller that turns the periodic walk off (tests) must not be left with a
    // chase cadence stricter than the interval it overrode.
    this.chainFollowChaseIntervalMs = Math.min(
      CHAIN_FOLLOW_CHASE_INTERVAL_MS,
      this.chainFollowIntervalMs,
    );
    this.env = options.env ?? process.env;
    this.listCandidates = options.listCandidates;
    this.onChange = options.onChange;
    this.onAttached = options.onAttached;
  }

  /**
   * Start the sweep. Provider processes are daemon children, so after a restart
   * every stored agent is unowned and may already have been continued elsewhere —
   * B6-OWN-HEAL (F19) makes that discovery run NOW instead of one interval from now:
   * the whole point of the watcher is to answer 「谁在写这个会话」 for sessions the
   * daemon is not writing, and waiting a minute on the first tick is what left the
   * user's entire list on 「未知」 after every restart. Everything the first pass
   * touches is `unref()`d and every failure it can hit is caught (inside `sweep` and
   * per candidate inside `discover`), so a cold-start read failure degrades to the
   * interval rather than to a daemon that never finishes booting.
   */
  start(): void {
    if (this.sweepTimer || this.stopped) {
      return;
    }
    this.tick();
    this.sweepTimer = setInterval(() => {
      this.tick();
    }, this.statPollIntervalMs);
    this.sweepTimer.unref();
  }

  /** The fire-and-forget path (startup, interval): skips while a pass is running. */
  private tick(): void {
    if (this.pass) {
      return;
    }
    void this.sweep();
  }

  stop(): void {
    this.stopped = true;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const agentId of Array.from(this.entries.keys())) {
      this.detach(agentId);
    }
  }

  /** True after `stop()`: callers must not read a null attach as "no transcript". */
  get isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Begin observing a transcript paseo is not writing (agent closed / released).
   * Resolves the provider transcript path first: providers without transcript
   * knowledge never get an entry, which is what keeps them out of `external`.
   *
   * B8-WATCH (F28): the resolved path is only the START of the observation. The
   * handle names the file paseo left behind; an `omp resume` in the user's terminal
   * has possibly already forked the conversation into a newer file, and the watcher
   * tails the leaf of that chain, not the handle.
   */
  async attach(candidate: TranscriptWatchCandidate): Promise<TranscriptAttachment | null> {
    if (this.stopped) {
      return null;
    }
    this.detach(candidate.agentId);
    const transcriptPath = await resolveProviderTranscriptPath({
      provider: candidate.provider,
      persistence: candidate.persistence,
      cwd: candidate.cwd,
      env: this.env,
    });
    if (!transcriptPath) {
      // B6-REVIEW: a permanent answer for opencode (shared database, no transcript
      // file) and for any handle whose identity cannot be a transcript path (R4-31).
      // Remembered so discovery stops paying for it; forgotten when the candidate
      // leaves the watch set or the queue, since a worktree or rollout can come back.
      this.unresolvable.add(candidate.agentId);
      return null;
    }
    const chain = await this.resolveResumeChain(candidate.provider, transcriptPath);
    const leaf = chain[chain.length - 1];
    const entry: WatchEntry = {
      candidate,
      chain,
      transcriptPath: leaf,
      chainBaseBytes: await statBytesSum(chain.slice(0, -1)),
      cursor: candidate.baselineBytes,
      watcher: null,
      debounce: null,
      checking: false,
      attachSeq: (this.entrySeq += 1),
      lastActiveMs: Date.now(),
      // The walk above is this entry's first one.
      lastChainFollowMs: Date.now(),
      lastGrowthMs: 0,
      // B9-SUBACT: cold tree state — the first `check` scans the child directory
      // (an active subagent at attach time is live evidence worth reporting even
      // when the main transcript needs only a silent baseline).
      lastSubagentScanMs: 0,
      subagentCount: undefined,
      subagentDirKey: null,
      subagentWrites: null,
    };
    this.entries.set(candidate.agentId, entry);
    this.acquireWatcherSlot(entry);
    // Don't wait a whole poll interval to learn what already happened. A first
    // observation with no persisted cursor just establishes the baseline, which is
    // returned so the caller can persist it as "the transcript as paseo left it".
    await this.check(candidate.agentId);
    return { transcriptPath: leaf, baselineBytes: entry.cursor };
  }

  /** Stop observing: paseo took the session back, or the agent left the directory. */
  detach(agentId: string): void {
    // B6-REVIEW: leaving the watch set forgets the negative resolution as well —
    // before the entry lookup, because an unresolvable candidate never had an entry.
    // `attach` routes through here, so an explicit attach always re-asks the provider.
    this.unresolvable.delete(agentId);
    const entry = this.entries.get(agentId);
    if (!entry) {
      return;
    }
    this.entries.delete(agentId);
    if (entry.debounce) {
      clearTimeout(entry.debounce);
      entry.debounce = null;
    }
    entry.watcher?.close();
    entry.watcher = null;
  }

  /**
   * Run one full pass and wait for it. A caller that asks for a sweep always gets
   * one that observed the state as of NOW: while another pass is still running (the
   * startup discovery batch, or an interval tick) this waits for it and then runs its
   * own, so refresh-on-demand and the tests can never return having observed nothing.
   * The timer path uses {@link tick}, which skips instead — a slow store must not
   * queue passes behind itself.
   */
  async sweep(): Promise<void> {
    if (this.stopped) {
      return;
    }
    // Set synchronously (before the first await inside) so `tick` sees the pass and
    // skips instead of stacking a second one behind it.
    const pass = this.runQueuedPass(this.pass);
    this.pass = pass;
    try {
      await pass;
    } finally {
      if (this.pass === pass) {
        this.pass = null;
      }
    }
  }

  private async runQueuedPass(previous: Promise<void> | null): Promise<void> {
    if (previous) {
      await previous;
      if (this.stopped) {
        return;
      }
    }
    await this.runSweep();
  }

  /** One pass: discover newly eligible agents, then stat every attached cursor. */
  private async runSweep(): Promise<void> {
    try {
      const candidates = await this.listCandidates();
      const eligible = new Set<string>();
      const undiscovered: TranscriptWatchCandidate[] = [];
      for (const candidate of candidates) {
        if (Date.now() - candidate.updatedAtMs > WATCH_RETENTION_MS) {
          continue;
        }
        eligible.add(candidate.agentId);
        if (!this.entries.has(candidate.agentId)) {
          undiscovered.push(candidate);
        }
      }
      // B6-REVIEW: the unresolvable memory only covers rows still in the queue. A
      // candidate that left it — dropped from the store, or aged past the retention
      // window — earns a fresh attempt if it shows up again, because its transcript
      // path may exist by then. Also bounds the set at `eligible.size`.
      for (const agentId of Array.from(this.unresolvable)) {
        if (!eligible.has(agentId)) {
          this.unresolvable.delete(agentId);
        }
      }
      await this.discover(undiscovered);
      for (const agentId of Array.from(this.entries.keys())) {
        if (!eligible.has(agentId)) {
          this.detach(agentId);
        }
      }
      // B6-REVIEW (RevB6 finding 1, minor): discovery keeps its place IN FRONT of the
      // stat pass. A full batch delays the already-watched cursors by up to 31 throttle
      // gaps plus one resolve each; that price buys the two properties the order was
      // holding — an entry attached this pass is stat-checked this pass too, which is
      // what digests a multi-megabyte backlog inside one pass (R4-23) instead of
      // leaving its tail for the next interval — and the delay is now bounded by
      // *successful* attaches: the doomed batch that ate ~970ms every minute is gone.
      for (const agentId of Array.from(this.entries.keys())) {
        await this.check(agentId);
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Transcript watch sweep failed");
    }
  }

  /**
   * B6-OWN-HEAL: attach this pass's share of the not-yet-observed candidates —
   * newest activity first (those are the rows the user is looking at), capped so a
   * big store spreads its cold-start reads over several sweeps, throttled between
   * reads, and isolated per candidate: one unreadable transcript (deleted file, dead
   * mount, provider with no transcript knowledge) must not cost the rest their
   * observation. Same posture as the list projection's (B5-REVIEW S2/S3): a read
   * failure is logged and skipped, never thrown at the caller.
   *
   * B6-REVIEW (RevB6 finding 1): the cap counts successful attaches, not attempts.
   * Counting attempts let a wall of candidates whose transcript cannot be resolved —
   * opencode by design, a deleted claude worktree, an omp/pi handle that no longer
   * looks like a transcript path, a rolled-away codex rollout, a record whose
   * `updatedAt` failed to parse and fell back to `Date.now()` (so it sorts first every
   * pass) — permanently own the newest-N window: every pass retried the same doomed
   * batch and every observable session behind it starved, which is the exact F19
   * starvation this batch exists to remove. An empty resolution is remembered in
   * {@link unresolvable} and costs its one attempt ever; a resolution that THREW is
   * not, because a dead mount comes back. Attempts stay bounded by
   * {@link MAX_DISCOVERY_ATTEMPT_MULTIPLIER} so the memory can never turn into an
   * unbounded per-pass scan.
   */
  private async discover(undiscovered: TranscriptWatchCandidate[]): Promise<void> {
    if (undiscovered.length === 0) {
      return;
    }
    undiscovered.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    const maxAttempts = this.maxNewAttachmentsPerSweep * MAX_DISCOVERY_ATTEMPT_MULTIPLIER;
    let attached = 0;
    let attempted = 0;
    for (const candidate of undiscovered) {
      if (this.stopped || attached >= this.maxNewAttachmentsPerSweep || attempted >= maxAttempts) {
        return;
      }
      if (this.unresolvable.has(candidate.agentId)) {
        continue;
      }
      // The gap is paid before each attempt after the first: same throttle as the old
      // batch, and never paid for a candidate this pass is not going to try.
      if (this.attachThrottleMs > 0 && attempted > 0) {
        await delay(this.attachThrottleMs);
      }
      attempted += 1;
      try {
        const attachment = await this.attach(candidate);
        if (attachment) {
          attached += 1;
          // R4-03: hand a freshly established baseline to the caller for persistence;
          // `attach()` callers that already persist (the manager's release path) go
          // through their own commit, not this hook.
          if (
            attachment.baselineBytes !== null &&
            attachment.baselineBytes !== candidate.baselineBytes
          ) {
            await this.onAttached?.(candidate.agentId, attachment);
          }
        }
      } catch (error) {
        this.logger.warn(
          { err: error, agentId: candidate.agentId, provider: candidate.provider },
          "Transcript watch discovery attach failed; relying on later sweeps",
        );
      }
    }
  }

  /** Exposed for tests and for the manager's shutdown assertion. */
  get watchedAgentIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Exposed for tests (R4-22): entries currently holding an `fs.watch` slot. */
  get fastPathAgentIds(): string[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.watcher !== null)
      .map((entry) => entry.candidate.agentId);
  }

  private countWatchers(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.watcher) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * R4-22: watcher slots are shared fairly. A fresh release takes a free slot;
   * when every slot is busy the least-recently-active holder steps down to the
   * stat sweep — it keeps its entry and cursor, only the fast path moves — so
   * the newest released session is never permanently starved behind a wall of
   * older watchers (insertion order made exactly that the default).
   */
  private acquireWatcherSlot(entry: WatchEntry): void {
    if (this.maxWatchers <= 0) {
      return;
    }
    if (this.countWatchers() < this.maxWatchers) {
      this.openWatcher(entry);
      return;
    }
    let victim: WatchEntry | null = null;
    for (const other of this.entries.values()) {
      if (other === entry || !other.watcher) {
        continue;
      }
      if (
        victim === null ||
        other.lastActiveMs < victim.lastActiveMs ||
        (other.lastActiveMs === victim.lastActiveMs && other.attachSeq < victim.attachSeq)
      ) {
        victim = other;
      }
    }
    if (victim === null) {
      return;
    }
    victim.watcher?.close();
    victim.watcher = null;
    this.openWatcher(entry);
  }

  private openWatcher(entry: WatchEntry): void {
    try {
      const watcher = watch(entry.transcriptPath, () => {
        this.scheduleCheck(entry.candidate.agentId);
      });
      watcher.on("error", (error) => {
        // Expected on Windows when the writer replaces the file, and on network
        // mounts. The stat sweep is the guarantee; the watcher is the fast path.
        this.logger.debug(
          { err: error, agentId: entry.candidate.agentId },
          "Transcript watcher failed; relying on stat poll",
        );
        entry.watcher?.close();
        entry.watcher = null;
      });
      entry.watcher = watcher;
    } catch (error) {
      this.logger.debug(
        { err: error, agentId: entry.candidate.agentId },
        "Transcript watch unavailable; relying on stat poll",
      );
    }
  }

  private scheduleCheck(agentId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) {
      return;
    }
    if (entry.debounce) {
      clearTimeout(entry.debounce);
    }
    entry.debounce = setTimeout(() => {
      entry.debounce = null;
      void this.check(agentId);
    }, this.debounceMs);
    entry.debounce.unref();
  }

  /**
   * Compare the transcript size against the cursor and, when it moved, report the
   * appended rows. A shrink (omp/pi self-repair their journal by truncating torn
   * lines) re-reads from byte 0: the writer rewrote the file, so everything it now
   * contains is evidence of an external writer.
   *
   * B9-SUBACT: the child-tree scan rides the same tick (its own two-tier gate
   * inside {@link observeSubagentTree}). A count move is observable on its own —
   * the caller escalates it exactly like foreign bytes — so a silent leaf with a
   * changed tree reports instead of returning.
   */
  private async check(agentId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    if (!entry || entry.checking) {
      return;
    }
    entry.checking = true;
    entry.lastActiveMs = Date.now();
    try {
      const subagent = await this.observeSubagentTree(entry);
      if (this.entries.get(agentId) !== entry) {
        return;
      }
      let size = await statTranscriptBytes(entry.transcriptPath);
      if (size === null) {
        return;
      }
      if (entry.cursor === null) {
        entry.cursor = entry.chainBaseBytes + size;
        // First observation: the main rows are paseo's own history (silent
        // baseline), but an ACTIVE child tree is live evidence either way.
        if (subagent?.changed && subagent.count > 0) {
          await this.reportSubagentActivity(entry);
        }
        return;
      }
      if (entry.chainBaseBytes + size === entry.cursor) {
        // B8-WATCH (F28): the leaf went silent. Either the external writer finished,
        // or it resumed the conversation into a NEWER transcript and everything after
        // this point is being written where the cursor cannot see it.
        const moved = await this.followResumeChain(entry, size);
        if (this.entries.get(agentId) !== entry) {
          // The walk is this pass's longest await. A detach while it ran (paseo took
          // the session back, or shutdown) ends the observation here rather than
          // reporting bytes for an agent this service no longer watches.
          return;
        }
        if (moved) {
          size = await statTranscriptBytes(entry.transcriptPath);
          if (size === null) {
            return;
          }
        }
        if (entry.chainBaseBytes + size === entry.cursor) {
          if (subagent?.changed) {
            await this.reportSubagentActivity(entry);
          }
          return;
        }
      }
      const appended = await this.readAppended(entry, size);
      entry.cursor = entry.chainBaseBytes + appended.cursor;
      entry.lastGrowthMs = Date.now();
      const externalLooksActive = await this.entryLooksActive(entry);
      await this.onChange({
        agentId,
        transcriptPath: entry.transcriptPath,
        items: appended.items,
        baselineBytes: entry.cursor,
        externalLooksActive,
        ...(entry.subagentCount !== undefined ? { activeSubagents: entry.subagentCount } : {}),
      });
    } catch (error) {
      this.logger.warn(
        { err: error, agentId, transcriptPath: entry.transcriptPath },
        "Transcript tail read failed",
      );
    } finally {
      entry.checking = false;
    }
  }

  /**
   * B9-SUBACT: gated tree observation riding the entry's tick. The SAME two-tier
   * cost gate as the resume walk decides (an active child tree keeps the entry
   * "fresh", so while children run the scan stays on the chase cadence); when the
   * gate holds, returns null and the entry's last known count stands. omp only —
   * no other provider spawns children into a per-session directory.
   */
  private async observeSubagentTree(
    entry: WatchEntry,
  ): Promise<{ count: number; changed: boolean } | null> {
    if (entry.candidate.provider !== "omp") {
      return null;
    }
    const now = Date.now();
    const cadenceMs =
      now - entry.lastGrowthMs < LOOKS_ACTIVE_MTIME_WINDOW_MS
        ? this.chainFollowChaseIntervalMs
        : this.chainFollowIntervalMs;
    if (now - entry.lastSubagentScanMs < cadenceMs) {
      return null;
    }
    entry.lastSubagentScanMs = now;
    return this.refreshSubagentTree(entry);
  }

  /**
   * B9-SUBACT: the ungated scan body — readdir the child directory and stat every
   * `*.jsonl` (the chain-tail discipline carried over: stats only, ZERO header
   * reads, so the flood B9-WATCH2 measured in production — 62 children under one
   * session — costs 62 stats, not 62 parses). Updates the entry's tree state in
   * place and reports whether the count moved observably.
   */
  private async refreshSubagentTree(
    entry: WatchEntry,
  ): Promise<{ count: number; changed: boolean } | null> {
    const dir = subagentDirOf(entry.transcriptPath);
    if (dir === null) {
      return null;
    }
    const dirKey = sessionPathKey(dir);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      // ENOENT/ENOTDIR = no child directory: this session never spawned — a
      // scanned-quiet tree, and an observed parent whose child rows the import
      // screen may authoritatively answer idle for.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        const previous = entry.subagentCount;
        entry.subagentCount = 0;
        entry.subagentDirKey = dirKey;
        entry.subagentWrites = new Map();
        return { count: 0, changed: subagentCountChanged(previous, 0) };
      }
      this.logger.debug(
        { err: error, agentId: entry.candidate.agentId, dir },
        "Subagent tree scan failed; keeping the last observed count",
      );
      return null;
    }
    const now = Date.now();
    const writes = new Map<string, number>();
    let count = 0;
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const file = path.join(dir, name);
      try {
        const info = await stat(file);
        writes.set(sessionPathKey(file), info.mtimeMs);
        if (now - info.mtimeMs < LOOKS_ACTIVE_MTIME_WINDOW_MS) {
          count += 1;
        }
      } catch {
        // Vanished between readdir and stat: not a live child, and not a tree
        // the import overlay should claim to have seen.
      }
    }
    const previous = entry.subagentCount;
    entry.subagentCount = count;
    entry.subagentDirKey = dirKey;
    entry.subagentWrites = writes;
    if (count > 0) {
      // A live tree IS foreign activity: it keeps both this scan and the resume
      // walk on the chase cadence while the subagents run.
      entry.lastGrowthMs = now;
    }
    return { count, changed: subagentCountChanged(previous, count) };
  }

  /**
   * R4 signal for this entry: does the external writer look alive? B9-SUBACT:
   * a live child tree IS a live external writer even when the main transcript's
   * own probe answers idle — the F31 contagion ruling, one rule for both the
   * byte-change report and the subagent-only report.
   */
  private async entryLooksActive(entry: WatchEntry): Promise<boolean> {
    return (
      (entry.subagentCount ?? 0) > 0 ||
      (await probeExternalTranscriptActivity({
        provider: entry.candidate.provider,
        transcriptPath: entry.transcriptPath,
        sessionId: entry.candidate.persistence?.sessionId ?? "",
        env: this.env,
      }))
    );
  }

  /**
   * B9-SUBACT: the tree moved while the leaf did not. `items: []` is the R4-04
   * posture — a change with no visible row is foreign evidence, not a no-op — so
   * the caller escalates ownership on it exactly like foreign bytes (card §2:
   * daemon not writing while the subtree grows = external, running), and the
   * decay to 0 rides the same channel to disarm the badge and the 运行中 flag.
   */
  private async reportSubagentActivity(entry: WatchEntry): Promise<void> {
    await this.onChange({
      agentId: entry.candidate.agentId,
      transcriptPath: entry.transcriptPath,
      items: [],
      baselineBytes: entry.cursor ?? entry.chainBaseBytes,
      externalLooksActive: await this.entryLooksActive(entry),
      activeSubagents: entry.subagentCount ?? 0,
    });
  }

  /**
   * B9-SUBACT (F31 B+, card §5): the watcher's live verdict for an omp CHILD
   * transcript, consumed by the import screen's descriptor overlay. `true`/`false`
   * = the child sits under an observed agent's directory and was (not) written
   * inside the freshness window at the last scan — the scan's mtime estimate is
   * replaced. `null` = nobody watches this child's parent, or it landed after the
   * last scan, so the mtime estimate stands (an unobserved session has no live
   * answer to give, and the overlay says so by staying out of it).
   */
  subagentLiveState(transcriptPath: string): boolean | null {
    const key = sessionPathKey(transcriptPath);
    for (const entry of this.entries.values()) {
      const dirKey = entry.subagentDirKey;
      const writes = entry.subagentWrites;
      if (dirKey === null || writes === null) {
        continue;
      }
      if (!key.startsWith(`${dirKey}${path.sep}`)) {
        continue;
      }
      const mtimeMs = writes.get(key);
      if (mtimeMs === undefined) {
        return null;
      }
      return Date.now() - mtimeMs < LOOKS_ACTIVE_MTIME_WINDOW_MS;
    }
    return null;
  }

  /**
   * B8-WATCH (F28): move this entry onto a newer leaf of its omp resume chain, in
   * place. Returns whether the observation actually moved.
   *
   * Two cadences, both floored so a chatty writer cannot turn the sweep into a
   * directory-scan loop. An entry that saw foreign bytes inside
   * {@link LOOKS_ACTIVE_MTIME_WINDOW_MS} is the one that can fork next — `omp resume`
   * happens right after the user stops writing — so it is re-walked every
   * `chainFollowChaseIntervalMs`. A long-quiet entry is re-checked every
   * `chainFollowIntervalMs`, which still picks up a session resumed while no daemon
   * was watching.
   *
   * B9-WATCH3: the walk is a known-tail chase. `entry.transcriptPath` is the
   * newest link this service has observed, so the walk considers only siblings
   * newer than it — a tick where the fork has not landed costs a readdir and
   * zero header reads instead of re-reading the whole candidate window, and a
   * flooded directory finds the real child inside the widened (200, stop-on-hit)
   * window.
   *
   * The cursor is chain-cumulative, which is what keeps the ownership baseline
   * continuous: the prefix moves past the old leaf (and past any intermediate file
   * the same walk crossed), the cursor stays where it is, so the new leaf is read
   * from byte 0. A resumed transcript is entirely foreign work by construction —
   * paseo wrote nothing to it — so reporting all of it is correct, and the caller's
   * tail-alignment belt absorbs the rows the parent file already showed.
   */
  private async followResumeChain(entry: WatchEntry, leafSize: number): Promise<boolean> {
    const now = Date.now();
    const sinceWalk = now - entry.lastChainFollowMs;
    const cadenceMs =
      now - entry.lastGrowthMs < LOOKS_ACTIVE_MTIME_WINDOW_MS
        ? this.chainFollowChaseIntervalMs
        : this.chainFollowIntervalMs;
    if (sinceWalk < cadenceMs) {
      return false;
    }
    entry.lastChainFollowMs = now;
    const tail = await this.resolveResumeChain(entry.candidate.provider, entry.transcriptPath, {
      knownTail: true,
    });
    const leaf = tail[tail.length - 1];
    if (tail.length < 2 || leaf === entry.transcriptPath) {
      return false;
    }
    const previousLeaf = entry.transcriptPath;
    entry.chainBaseBytes += leafSize + (await statBytesSum(tail.slice(1, -1)));
    entry.chain = [...entry.chain.slice(0, -1), ...tail];
    entry.transcriptPath = leaf;
    entry.lastActiveMs = now;
    // B9-SUBACT: the child directory follows the LEAF — a resumed session spawns
    // its subagents under the new session id, and the old tree is history. The
    // tree state is re-observed immediately (this path already paid for a
    // directory walk), so the change the caller emits for the migration carries
    // the new tree's count, not the old leaf's.
    entry.lastSubagentScanMs = Date.now();
    await this.refreshSubagentTree(entry);
    if (entry.watcher) {
      // The fast path this entry already holds moves with it; no slot is taken
      // from or returned to another entry (R4-22 fairness is unaffected).
      entry.watcher.close();
      entry.watcher = null;
      this.openWatcher(entry);
    }
    this.logger.info(
      { agentId: entry.candidate.agentId, previousLeaf, leaf },
      "Transcript watch followed the omp resume chain to a newer transcript",
    );
    return true;
  }

  /**
   * B8-WATCH (F28): the chain to observe for a freshly resolved transcript.
   * `[filePath]` for every provider that keeps one file per session; the full
   * resume chain for omp. A failed walk degrades to the file itself — losing an
   * existing observation to a directory scan that threw would be worse than
   * tailing the older transcript until the next sweep.
   *
   * `knownTail` (B9-WATCH3) asserts `filePath` is the leaf the caller already
   * observed: the walk then stats the tail's newer siblings instead of reading
   * the whole window's headers. Only the chase in {@link followResumeChain}
   * may claim this; attach starts cold.
   */
  private async resolveResumeChain(
    provider: AgentProvider,
    filePath: string,
    options: { knownTail?: boolean } = {},
  ): Promise<string[]> {
    if (provider !== "omp") {
      return [filePath];
    }
    try {
      return await resolveOmpResumeLeafChain(filePath, {
        logger: this.logger,
        knownTail: options.knownTail,
      });
    } catch (error) {
      this.logger.debug(
        { err: error, filePath },
        "Resume chain walk failed; tailing the resolved transcript",
      );
      return [filePath];
    }
  }

  /**
   * Read `[cursor, size)` and stop at the last newline so a half-written row is
   * left for the next check instead of being parsed (and lost) as if complete.
   */
  private async readAppended(
    entry: WatchEntry,
    size: number,
  ): Promise<{ items: AgentTimelineItem[]; cursor: number }> {
    // The cursor is cumulative; the file is read from where the chain prefix ends.
    const cursor = Math.max(0, (entry.cursor ?? 0) - entry.chainBaseBytes);
    // A SHRINK means the writer rewrote the journal (omp/pi truncate torn lines and
    // re-append on resume). Everything the file now holds is foreign work, so the
    // whole thing is re-read instead of the empty tail it would otherwise yield.
    const from = size < cursor ? 0 : cursor;
    if (size === from) {
      return { items: [], cursor: from };
    }
    const length = Math.min(size - from, MAX_TAIL_READ_BYTES);
    const buffer = await readTranscriptRange(entry.transcriptPath, from, length);
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) {
      if (length < size - from) {
        // R4-23: the read hit the cap before any newline — a single row longer
        // than the cap never completes line-wise. Skip it as unparseable meta
        // (bytes changed, no visible message); the next check continues from
        // the cap boundary instead of re-reading the same prefix forever.
        return { items: [], cursor: from + length };
      }
      // No complete row yet; keep the cursor and wait for the rest of the line.
      return { items: [], cursor: from };
    }
    const complete = buffer.subarray(0, lastNewline + 1).toString("utf8");
    return {
      items: mapProviderTranscriptLines(entry.candidate.provider, complete),
      cursor: from + lastNewline + 1,
    };
  }
}

/** Read exactly `[position, position+length)` of a transcript without loading it. */
async function readTranscriptRange(
  filePath: string,
  position: number,
  length: number,
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Σ byte sizes of chain files. A file that cannot be stat'd contributes 0: an
 * ancestor deleted mid-walk has to be treated as "no bytes of history there",
 * which reads the surviving leaf from the start — foreign work, the safe answer.
 */
async function statBytesSum(filePaths: readonly string[]): Promise<number> {
  const sizes = await Promise.all(filePaths.map((filePath) => statTranscriptBytes(filePath)));
  return sizes.reduce<number>((total, size) => total + (size ?? 0), 0);
}

/**
 * B9-SUBACT: the directory omp spawns this transcript's subagents into —
 * `<parentStem>/` next to `<parentStem>.jsonl` (the production shape B9-WATCH2
 * measured: dozens of `<AgentName>.jsonl` children under it). Null for a path
 * that is not a provider transcript file.
 */
function subagentDirOf(transcriptPath: string): string | null {
  return transcriptPath.endsWith(".jsonl") ? transcriptPath.slice(0, -".jsonl".length) : null;
}

/**
 * B9-SUBACT: a count move is observable when there is something it says: the
 * first scan of a quiet tree (undefined → 0) says nothing; a first scan that
 * finds live children says everything; and any later move — including the decay
 * back to 0 — says the badge must change.
 */
function subagentCountChanged(previous: number | undefined, count: number): boolean {
  return previous === undefined ? count > 0 : count !== previous;
}

/** B6-OWN-HEAL: the discovery batch's inter-attach gap (unref'd: a pending gap must
 * never hold the process open on shutdown). */
function delay(ms: number): Promise<void> {
  // Executor form on purpose: this package's TS lib predates `Promise.withResolvers`
  // (es2024), and the gap must not become a reason to skip the throttle.
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
