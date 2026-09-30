import { open, readFile, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentProvider } from "./agent-sdk-types.js";
import { LOOKS_ACTIVE_MTIME_WINDOW_MS } from "./provider-transcript.js";

/**
 * Paseo Go B4-OWNERSHIP (batch-4 F8, R2-lite): the `externalLooksActive` signal.
 *
 * `ownership === "external"` already means "somebody else wrote this transcript".
 * R4's warning needs the sharper question — *are they still writing?* — because
 * sending into a session another terminal is mid-turn on is the fork risk, while
 * sending into a finished external session is just a resume (that is R5's normal
 * path). The signals below are the read-only upgrades measured in
 * `paseo-go/RESEARCH-provider-dual-write.md`, strictly better than mtime where the
 * provider exposes them:
 *
 * - claude  : `~/.claude/sessions/<pid>.json` is a LIVE-PROCESS REGISTRY (entries
 *   carry pid/sessionId/cwd/startedAt and are deleted on exit) → exact.
 * - codex /
 *   omp     : the running client keeps the rollout/session file open WITHOUT
 *   write-sharing, so opening it read-write fails with a sharing violation
 *   (measured on win32: `EBUSY`) → exact on Windows.
 * - pi      : holds no handle and registers nothing → mtime/size freshness only.
 * - opencode: shared SQLite DB, every writer sees every row, no per-session file →
 *   never "active" (research ruling: the R4 warning is pure noise for opencode).
 *
 * Every probe is read-only and best-effort: any error means "no evidence", which
 * renders as a plain `external` row rather than a warning.
 */

/** Errno codes a Windows sharing violation surfaces as (measured: EBUSY). */
const SHARING_VIOLATION_CODES: Record<string, true> = {
  EBUSY: true,
  EPERM: true,
  EACCES: true,
};

export interface ExternalActivityProbeInput {
  provider: AgentProvider;
  /** Transcript path from `resolveProviderTranscriptPath`; null = nothing to probe. */
  transcriptPath: string | null;
  /** Provider session identity (claude registry lookup key). */
  sessionId: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable clock for tests. */
  now?: number;
}

/** True when the external writer behind an `external` session looks alive. */
export async function probeExternalTranscriptActivity(
  input: ExternalActivityProbeInput,
): Promise<boolean> {
  const env = input.env ?? process.env;
  switch (input.provider) {
    case "claude":
      return claudeRegistryLooksActive({
        sessionId: input.sessionId,
        configDir: env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
      });
    case "codex":
    case "omp": {
      const held = await transcriptHandleIsHeld(input.transcriptPath);
      // POSIX opens never conflict, so the handle probe cannot answer there;
      // freshness is the best available evidence on that platform.
      return held ?? transcriptLooksFresh(input.transcriptPath, input.now ?? Date.now());
    }
    case "pi":
      return transcriptLooksFresh(input.transcriptPath, input.now ?? Date.now());
    default:
      // opencode and unknown providers expose nothing per-session.
      return false;
  }
}

/**
 * `~/.claude/sessions/<pid>.json` is Claude Code's live-process registry: one file
 * per running process, removed when it exits. A row whose `sessionId` matches and
 * whose `pid` still answers a signal-0 probe means another terminal is holding the
 * very session paseo is about to resume.
 */
export async function claudeRegistryLooksActive(input: {
  sessionId: string;
  configDir: string;
}): Promise<boolean> {
  if (!input.sessionId) {
    return false;
  }
  const registryDir = path.join(input.configDir, "sessions");
  const names = await readdir(registryDir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const entry = await readJsonRecord(path.join(registryDir, name));
    if (!entry || entry.sessionId !== input.sessionId) {
      continue;
    }
    if (typeof entry.pid === "number" && isPidRunning(entry.pid)) {
      return true;
    }
  }
  return false;
}

/**
 * `process.kill(pid, 0)` probes existence without signalling: ESRCH = gone,
 * EPERM = exists but owned by somebody else (still alive). Same convention as
 * `server/pid-lock.ts`.
 */
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True = a live process holds the transcript without sharing write.
 * Null = the platform cannot express the question (POSIX opens never conflict),
 * so the caller must fall back to a weaker signal rather than read false as proof.
 */
export async function transcriptHandleIsHeld(filePath: string | null): Promise<boolean | null> {
  if (!filePath || process.platform !== "win32") {
    return null;
  }
  let handle: FileHandle | null = null;
  try {
    handle = await open(filePath, "r+");
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    return code in SHARING_VIOLATION_CODES;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Freshness heuristic (not a liveness proof): written inside the shared window. */
export async function transcriptLooksFresh(filePath: string | null, now: number): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  const info = await stat(filePath).catch(() => null);
  if (!info) {
    return false;
  }
  return now - info.mtimeMs < LOOKS_ACTIVE_MTIME_WINDOW_MS;
}

async function readJsonRecord(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
