import { watch } from "node:fs";
import { open } from "node:fs/promises";
import type { FSWatcher } from "node:fs";
import type { Logger } from "pino";

import type {
  AgentPersistenceHandle,
  AgentProvider,
  AgentTimelineItem,
} from "./agent-sdk-types.js";
import {
  mapProviderTranscriptLines,
  resolveProviderTranscriptPath,
  statTranscriptBytes,
} from "./provider-transcript.js";
import { probeExternalTranscriptActivity } from "./transcript-activity-probe.js";

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
 */

/** Debounce window collapsing a burst of watcher events into one tail read. */
const DEFAULT_DEBOUNCE_MS = 250;
/** Fallback stat sweep; overridden by `agents.transcriptStatPollIntervalMs`. */
export const DEFAULT_TRANSCRIPT_STAT_POLL_INTERVAL_MS = 60_000;
/** Concurrent `fs.watch` handles; extra transcripts stay on the stat sweep. */
const DEFAULT_MAX_WATCHERS = 64;
/** Agents untouched for longer than this stop being watched (opening them replays history). */
const WATCH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface TranscriptWatchCandidate {
  agentId: string;
  provider: AgentProvider;
  persistence: AgentPersistenceHandle | null;
  cwd: string;
  /** Persisted transcript cursor; null = first observation for this agent. */
  baselineBytes: number | null;
  /** Record `updatedAt` in ms; drives {@link WATCH_RETENTION_MS}. */
  updatedAtMs: number;
}

export interface TranscriptChange {
  agentId: string;
  transcriptPath: string;
  /** Rows the external writer appended since the cursor (empty = bytes changed, no visible message). */
  items: AgentTimelineItem[];
  /** New cursor to persist with the agent record. */
  baselineBytes: number;
  /** R4 signal: does the external writer still look alive? */
  externalLooksActive: boolean;
}

/** What `attach` learned: the transcript it now tails and the cursor it starts from. */
export interface TranscriptAttachment {
  transcriptPath: string;
  /**
   * Byte size the cursor is now at: the persisted one when the caller supplied it
   * (so growth during a daemon restart is still visible) or the freshly
   * established baseline when there was no prior observation.
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
  /** Called on the sweep tick; the manager answers from its agent storage. */
  listCandidates: () => Promise<TranscriptWatchCandidate[]>;
  onChange: (change: TranscriptChange) => Promise<void>;
}

interface WatchEntry {
  candidate: TranscriptWatchCandidate;
  transcriptPath: string;
  cursor: number | null;
  watcher: FSWatcher | null;
  debounce: ReturnType<typeof setTimeout> | null;
  checking: boolean;
}

export class TranscriptWatchService {
  private readonly logger: Logger;
  private readonly statPollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly maxWatchers: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly listCandidates: () => Promise<TranscriptWatchCandidate[]>;
  private readonly onChange: (change: TranscriptChange) => Promise<void>;
  private readonly entries = new Map<string, WatchEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweepInFlight = false;
  private stopped = false;

  constructor(options: TranscriptWatchServiceOptions) {
    this.logger = options.logger.child({ component: "transcript-watch" });
    this.statPollIntervalMs =
      options.statPollIntervalMs ?? DEFAULT_TRANSCRIPT_STAT_POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWatchers = options.maxWatchers ?? DEFAULT_MAX_WATCHERS;
    this.env = options.env ?? process.env;
    this.listCandidates = options.listCandidates;
    this.onChange = options.onChange;
  }

  /**
   * Start the sweep. The first tick also performs startup discovery: provider
   * processes are daemon children, so after a restart every stored agent is
   * unowned and may already have been continued elsewhere.
   */
  start(): void {
    if (this.sweepTimer || this.stopped) {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, this.statPollIntervalMs);
    this.sweepTimer.unref();
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
      return null;
    }
    const entry: WatchEntry = {
      candidate,
      transcriptPath,
      cursor: candidate.baselineBytes,
      watcher: null,
      debounce: null,
      checking: false,
    };
    this.entries.set(candidate.agentId, entry);
    if (this.countWatchers() < this.maxWatchers) {
      this.openWatcher(entry);
    }
    // Don't wait a whole poll interval to learn what already happened. A first
    // observation with no persisted cursor just establishes the baseline, which is
    // returned so the caller can persist it as "the transcript as paseo left it".
    await this.check(candidate.agentId);
    return { transcriptPath, baselineBytes: entry.cursor };
  }

  /** Stop observing: paseo took the session back, or the agent left the directory. */
  detach(agentId: string): void {
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

  /** One sweep: discover newly eligible agents, then stat every attached cursor. */
  async sweep(): Promise<void> {
    if (this.sweepInFlight || this.stopped) {
      return;
    }
    this.sweepInFlight = true;
    try {
      const candidates = await this.listCandidates();
      const eligible = new Set<string>();
      for (const candidate of candidates) {
        if (Date.now() - candidate.updatedAtMs > WATCH_RETENTION_MS) {
          continue;
        }
        eligible.add(candidate.agentId);
        if (!this.entries.has(candidate.agentId)) {
          await this.attach(candidate);
        }
      }
      for (const agentId of Array.from(this.entries.keys())) {
        if (!eligible.has(agentId)) {
          this.detach(agentId);
        }
      }
      for (const agentId of Array.from(this.entries.keys())) {
        await this.check(agentId);
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Transcript watch sweep failed");
    } finally {
      this.sweepInFlight = false;
    }
  }

  /** Exposed for tests and for the manager's shutdown assertion. */
  get watchedAgentIds(): string[] {
    return Array.from(this.entries.keys());
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
   */
  private async check(agentId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    if (!entry || entry.checking) {
      return;
    }
    entry.checking = true;
    try {
      const size = await statTranscriptBytes(entry.transcriptPath);
      if (size === null) {
        return;
      }
      if (entry.cursor === null) {
        entry.cursor = size;
        return;
      }
      if (size === entry.cursor) {
        return;
      }
      const appended = await this.readAppended(entry, size);
      entry.cursor = appended.cursor;
      const externalLooksActive = await probeExternalTranscriptActivity({
        provider: entry.candidate.provider,
        transcriptPath: entry.transcriptPath,
        sessionId: entry.candidate.persistence?.sessionId ?? "",
        env: this.env,
      });
      await this.onChange({
        agentId,
        transcriptPath: entry.transcriptPath,
        items: appended.items,
        baselineBytes: appended.cursor,
        externalLooksActive,
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
   * Read `[cursor, size)` and stop at the last newline so a half-written row is
   * left for the next check instead of being parsed (and lost) as if complete.
   */
  private async readAppended(
    entry: WatchEntry,
    size: number,
  ): Promise<{ items: AgentTimelineItem[]; cursor: number }> {
    const cursor = entry.cursor ?? 0;
    // A SHRINK means the writer rewrote the journal (omp/pi truncate torn lines and
    // re-append on resume). Everything the file now holds is foreign work, so the
    // whole thing is re-read instead of the empty tail it would otherwise yield.
    const from = size < cursor ? 0 : cursor;
    if (size === from) {
      return { items: [], cursor: from };
    }
    const buffer = await readTranscriptRange(entry.transcriptPath, from, size - from);
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) {
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
