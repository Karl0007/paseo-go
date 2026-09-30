import { existsSync, realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  AgentPersistenceHandle,
  AgentProvider,
  AgentTimelineItem,
} from "./agent-sdk-types.js";
import { claudeConfigDir, claudeProjectDirSync } from "./providers/claude/project-dir.js";

/**
 * Paseo Go B4-OWNERSHIP (batch-4 F8): the single funnel for "where does this
 * provider keep the transcript of this session, and what do its lines mean".
 *
 * Before this module the knowledge lived only inside each provider client (which
 * is right for running a session); the ownership state machine and its transcript
 * watcher are the first *generic* consumers, so the lookup is collected here as one
 * function over the persisted handle. Card rule: a provider this function cannot
 * answer for NEVER escalates to `external` — an unobservable transcript is reported
 * as `none`, not guessed at.
 *
 * Measured layouts (`paseo-go/RESEARCH-provider-dual-write.md` + local files):
 * - omp / pi : `persistence.nativeHandle` IS the session jsonl absolute path.
 * - claude   : `<configDir>/projects/<encode(realpath(cwd))>/<sessionId>.jsonl`,
 *              encoded by the SDK-verbatim port in providers/claude/project-dir.ts.
 * - codex    : `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`;
 *              paseo only stores the thread id, so the file is located by a bounded
 *              newest-first scan of the dated directories.
 * - opencode : no per-session transcript at all — one shared SQLite DB whose rows
 *              every server sees (research: zero dual-writer problem, and a DB-wide
 *              mtime would fire for unrelated sessions). Deliberately unobservable.
 */

/** Directories the codex rollout scan walks (years + months + days together). */
const CODEX_ROLLOUT_SCAN_DIR_BUDGET = 64;

/**
 * Freshness window for every "does this session look alive" heuristic in the agent
 * layer. Exported so the import-screen heuristic
 * (`providers/omp/session-descriptor.ts`) and the ownership probe
 * (`transcript-activity-probe.ts`) cannot drift into two different answers.
 * Freshness is a heuristic, never a liveness proof — the probe prefers the
 * provider-specific exact signals whenever the provider exposes them.
 */
export const LOOKS_ACTIVE_MTIME_WINDOW_MS = 5 * 60 * 1000;

export interface ProviderTranscriptInput {
  provider: AgentProvider;
  /** Straight off `StoredAgentRecord.persistence` / `ManagedAgent.persistence`. */
  persistence: AgentPersistenceHandle | null | undefined;
  /** Straight off the record's `cwd` (also mirrored into persistence.metadata.cwd). */
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Absolute path of the transcript file paseo can tail, or null when the provider
 * exposes none. Null is a permanent answer for opencode, for any handle that
 * lacks the identity the provider needs (no session id, no cwd), and for a
 * persisted handle whose identity cannot be a clean transcript path — handle
 * fields reach this funnel through the import RPC and are untrusted (R4-31).
 */
export async function resolveProviderTranscriptPath(
  input: ProviderTranscriptInput,
): Promise<string | null> {
  const env = input.env ?? process.env;
  const handle = input.persistence;
  if (!handle) {
    return null;
  }
  switch (input.provider) {
    case "omp":
    case "pi":
      return looksLikeTranscriptFile(handle.nativeHandle) ? handle.nativeHandle : null;
    case "claude":
      return resolveClaudeTranscriptPath({
        cwd: input.cwd,
        sessionId: handle.sessionId,
        configDir: claudeConfigDir(env),
      });
    case "codex":
      return findCodexRolloutFile({
        codexHome: env.CODEX_HOME ?? path.join(homedir(), ".codex"),
        threadId: handle.sessionId,
      });
    default:
      // opencode (shared DB) and any plugin/provider without transcript knowledge.
      return null;
  }
}

function looksLikeTranscriptFile(value: unknown): value is string {
  if (typeof value !== "string" || !value.endsWith(".jsonl") || value.includes("\0")) {
    return false;
  }
  // R4-31 (sink belt): an omp/pi handle is persisted verbatim from an import
  // RPC, and the watcher tails whatever this funnel returns. Provider-issued
  // handles are clean absolute paths; reject traversal segments, relative
  // spellings, and (on Windows) UNC/device spellings before `fs.watch`/`open`
  // ever sees them. Provenance is gated at the source (R4-30 revalidation).
  if (process.platform === "win32" && value.startsWith("\\\\")) {
    return false;
  }
  return path.isAbsolute(value) && path.normalize(value) === value;
}

/**
 * R4-31: ids that become path components (`${sessionId}.jsonl`, the rollout
 * filename suffix) are untrusted once persisted from a client handle. Only a
 * single, traversal-free path segment may be joined into a provider directory.
 */
function isSinglePathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    value !== "." &&
    value !== ".."
  );
}

/**
 * Same candidate order as the claude client's private `resolveHistoryPath`:
 * the literal cwd first, then its realpath, then fall back to the canonical
 * spelling so a not-yet-created file still yields a watchable path.
 */
export function resolveClaudeTranscriptPath(input: {
  cwd: string;
  sessionId: string;
  configDir?: string;
}): string | null {
  if (!input.cwd || !isSinglePathSegment(input.sessionId)) {
    return null;
  }
  const configDir = input.configDir ?? claudeConfigDir(process.env);
  const candidates = [input.cwd];
  try {
    const realCwd = realpathSync.native(input.cwd);
    if (realCwd && realCwd !== input.cwd) {
      candidates.push(realCwd);
    }
  } catch {
    // realpath failure just means the literal spelling is all we have.
  }
  let fallback: string | null = null;
  for (const candidate of candidates) {
    const historyPath = path.join(
      claudeProjectDirSync(candidate, { configDir }),
      `${input.sessionId}.jsonl`,
    );
    if (existsSync(historyPath)) {
      return historyPath;
    }
    fallback ??= historyPath;
  }
  return fallback;
}

/**
 * Locate `rollout-*-<threadId>.jsonl` under `<codexHome>/sessions/YYYY/MM/DD`.
 * Walks day directories newest-first (lexicographic == chronological for this
 * layout) and stops at the first match, bounded by
 * {@link CODEX_ROLLOUT_SCAN_DIR_BUDGET} — counted over EVERY directory the walk
 * opens (R4-10: slicing the year list left the month/day loops unbounded, so a
 * real ~/.codex re-walked its whole tree on every resolve) — so a long-lived
 * ~/.codex never turns ownership bookkeeping into an unbounded walk.
 */
export async function findCodexRolloutFile(input: {
  codexHome: string;
  threadId: string;
}): Promise<string | null> {
  if (!isSinglePathSegment(input.threadId)) {
    return null;
  }
  const suffix = `-${input.threadId}.jsonl`;
  const root = path.join(input.codexHome, "sessions");
  let budget = CODEX_ROLLOUT_SCAN_DIR_BUDGET;
  const years = await readSortedDirectories(root);
  for (const year of years) {
    if (budget <= 0) {
      return null;
    }
    budget -= 1;
    const months = await readSortedDirectories(path.join(root, year));
    for (const month of months) {
      if (budget <= 0) {
        return null;
      }
      budget -= 1;
      const days = await readSortedDirectories(path.join(root, year, month));
      for (const day of days) {
        if (budget <= 0) {
          return null;
        }
        budget -= 1;
        const dayDir = path.join(root, year, month, day);
        const names = await readdir(dayDir).catch(() => [] as string[]);
        const hit = names.find((name) => name.endsWith(suffix));
        if (hit) {
          return path.join(dayDir, hit);
        }
      }
    }
  }
  return null;
}

async function readSortedDirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

/**
 * Map a freshly appended transcript chunk to timeline items.
 *
 * Discipline from the research (R3): every line is untrusted JSON of a format the
 * provider is free to extend — a parse failure or an unknown `type` is SKIPPED,
 * never fatal and never guessed. claude in particular interleaves volatile meta
 * rows (`last-prompt`, `mode`, `queue-operation`) and omp/pi carry
 * `title_change`/`compaction`/`custom` rows; only chat-visible user/assistant text
 * becomes an item, so a provider bump that renames a control row costs a skipped
 * row, not a corrupted timeline.
 */
export function mapProviderTranscriptLines(
  provider: AgentProvider,
  chunk: string,
): AgentTimelineItem[] {
  const items: AgentTimelineItem[] = [];
  for (const line of chunk.split("\n")) {
    const record = parseJsonRecord(line);
    if (!record) {
      continue;
    }
    const item = mapTranscriptRecord(provider, record);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

/** Which row dialect a provider writes, or null when paseo knows none. */
function mapTranscriptRecord(
  provider: AgentProvider,
  record: Record<string, unknown>,
): AgentTimelineItem | null {
  switch (provider) {
    case "claude":
      return mapClaudeRecord(record);
    case "codex":
      return mapCodexRecord(record);
    case "omp":
    case "pi":
      return mapOmpFamilyRecord(record);
    default:
      return null;
  }
}

/**
 * The two roles that are chat messages, for every provider that names them.
 * Explicit comparisons (not a lookup table): a transcript is untrusted input and
 * a row claiming `role: "toString"` must not resolve through Object.prototype.
 */
function chatRole(value: unknown): "user" | "assistant" | null {
  if (value === "user") {
    return "user";
  }
  return value === "assistant" ? "assistant" : null;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function textMessage(
  role: "user" | "assistant",
  text: string,
  messageId: string | null,
): AgentTimelineItem | null {
  if (text.trim().length === 0) {
    return null;
  }
  return {
    type: role === "user" ? "user_message" : "assistant_message",
    text,
    ...(messageId ? { messageId } : {}),
  };
}

/** omp / pi share one journal layout: `{type:"message", id, message:{role,content}}`. */
function mapOmpFamilyRecord(record: Record<string, unknown>): AgentTimelineItem | null {
  if (record.type !== "message") {
    return null;
  }
  const message = asRecord(record.message);
  if (!message) {
    return null;
  }
  const role = chatRole(message.role);
  if (!role) {
    return null;
  }
  const text = joinTextBlocks(message.content, ["text"]);
  return textMessage(role, text, nonEmptyString(record.id));
}

/** claude: `{type:"user"|"assistant", isSidechain, uuid, message:{content}}`. */
function mapClaudeRecord(record: Record<string, unknown>): AgentTimelineItem | null {
  if (record.isSidechain === true) {
    return null;
  }
  const role = chatRole(record.type);
  if (!role) {
    return null;
  }
  const message = asRecord(record.message);
  if (!message) {
    return null;
  }
  const text = joinTextBlocks(message.content, ["text"]);
  return textMessage(role, text, nonEmptyString(record.uuid));
}

/** codex rollout: `{type:"response_item", payload:{type:"message", role, content}}`. */
function mapCodexRecord(record: Record<string, unknown>): AgentTimelineItem | null {
  if (record.type !== "response_item") {
    return null;
  }
  const payload = asRecord(record.payload);
  if (!payload || payload.type !== "message") {
    return null;
  }
  const role = chatRole(payload.role);
  if (!role) {
    return null;
  }
  const text = joinTextBlocks(payload.content, ["input_text", "output_text"]);
  return textMessage(role, text, nonEmptyString(payload.id) ?? nonEmptyString(record.id));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Concatenate the text payloads of the block types a provider uses for visible
 * message text. Content may be a bare string (claude user rows) or an array of
 * typed blocks; anything unrecognised contributes nothing.
 */
function joinTextBlocks(content: unknown, blockTypes: readonly string[]): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const entry of content) {
    const block = asRecord(entry);
    if (!block || !blockTypes.includes(String(block.type))) {
      continue;
    }
    const text = block.text;
    if (typeof text === "string" && text.length > 0) {
      parts.push(text);
    }
  }
  return parts.join("\n");
}

/** Byte size of a transcript, or null when it does not exist (yet). */
export async function statTranscriptBytes(filePath: string): Promise<number | null> {
  const info = await stat(filePath).catch(() => null);
  return info && info.isFile() ? info.size : null;
}
