import type { Logger } from "pino";
import type { Dirent } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  ImportableProviderSession,
  ListImportableSessionsOptions,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { LOOKS_ACTIVE_MTIME_WINDOW_MS } from "../../provider-transcript.js";
import {
  createRealpathAwarePathMatcher,
  looksLikeDefiniteWindowsPath,
} from "../../../../utils/path.js";

const OMP_CONFIG_DIR_NAME = ".omp";
const OMP_AGENT_DIR_ENV = "OMP_AGENT_DIR";
const OMP_SESSION_DIR_ENV = "OMP_SESSION_DIR";
// Import listing intentionally bounds header parsing to this window. Sessions
// with unusually large preambles may omit their first-prompt preview.
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
const FULL_SCAN_LINE_LIMIT = 2_000;
// Rank all discovered files cheaply, then parse only a bounded recent window.
// OMP keeps nested completed-subagent transcripts importable, so discovery
// remains recursive rather than applying Pi's historical parent-only depth cap.
const IMPORT_CANDIDATE_OVERSCAN = 40;
const IMPORT_CANDIDATE_MIN = 400;
// Freshness heuristic, not a liveness proof, and the only cue available HERE: an
// import candidate is a transcript paseo does not manage, so the ownership watcher
// (agent/transcript-watch-service.ts) is not attached to it and a recently touched
// mtime is the strongest available "possibly active" signal. Managed agents get the
// exact provider probes from agent/transcript-activity-probe.ts instead.

interface OmpSessionDescriptorOptions extends ListImportableSessionsOptions {
  sessionDir?: string;
  runtimeSettings?: ProviderRuntimeSettings;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

interface OmpSessionHeader {
  sessionId: string;
  parentId: string | null;
  cwd: string;
  createdAt: Date | null;
}

interface OmpSessionTail {
  title: string | null;
  lastActivityAt: Date | null;
  lastUserMessage: string | null;
  model: string | null;
  thinkingOptionId: string | null;
}

interface OmpSessionHead {
  title: string | null;
  firstUserMessage: string | null;
  model: string | null;
  thinkingOptionId: string | null;
}

interface OmpSessionDescriptor {
  sessionId: string;
  parentId: string | null;
  cwd: string;
  title: string | null;
  firstUserMessage: string | null;
  lastUserMessage: string | null;
  lastActivityAt: Date;
  model: string | null;
  thinkingOptionId: string | null;
}
interface RankedSessionFile {
  file: string;
  mtime: Date;
}

export interface OmpImportSessionConfig {
  model?: string;
  thinkingOptionId?: string;
}

export async function listOmpImportableSessions(
  options: OmpSessionDescriptorOptions = {},
): Promise<ImportableProviderSession[]> {
  const sessionsDir = await resolveOmpSessionsDir(options);
  const files = await walkJsonlFiles(sessionsDir);
  const matchesCwd = options.cwd ? createRealpathAwarePathMatcher(options.cwd) : null;
  const limit = options.limit ?? 20;
  const ranked = await rankSessionFilesByMtime(files);
  const candidateLimit = Math.min(
    options.scanLimit ?? Math.max(limit * IMPORT_CANDIDATE_OVERSCAN, IMPORT_CANDIDATE_MIN),
    500,
  );
  const candidates =
    options.scanLimit === undefined && matchesCwd ? ranked : ranked.slice(0, candidateLimit);
  // Parent-chain resolution never re-walks the tree: every path this scan already
  // discovered is indexed up front, and each transcript parsed below contributes
  // its session id and title. A parent outside the parsed window keeps its handle
  // id but loses its title.
  const index: OmpScanIndex = {
    discovered: new Set(ranked.map((entry) => sessionPathKey(entry.file))),
    parsedByKey: new Map(),
    pathBySessionId: new Map(),
  };
  const scannedAt = Date.now();
  const rows: ScannedOmpSession[] = [];

  for (const entry of candidates) {
    const descriptor = await readOmpSessionDescriptor(entry.file);
    if (!descriptor) continue;
    index.parsedByKey.set(sessionPathKey(entry.file), descriptor);
    if (!index.pathBySessionId.has(descriptor.sessionId)) {
      index.pathBySessionId.set(descriptor.sessionId, entry.file);
    }
    if (matchesCwd && !matchesCwd(descriptor.cwd)) continue;
    rows.push({ filePath: entry.file, mtime: entry.mtime, descriptor });
    if (rows.length >= limit) {
      break;
    }
  }

  // Links resolve after the parse pass so a parent parsed later in the window
  // still labels the children listed ahead of it.
  return rows
    .map((row) => toOmpImportableSession(row, index, scannedAt))
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
}

export async function readOmpImportSessionConfig(
  filePath: string,
): Promise<OmpImportSessionConfig> {
  const descriptor = await readOmpSessionDescriptor(filePath);
  if (!descriptor) return {};
  return toOmpImportSessionConfig(descriptor);
}

async function resolveOmpSessionsDir(options: OmpSessionDescriptorOptions): Promise<string> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const baseDir = options.cwd ?? process.cwd();

  if (options.sessionDir?.trim()) {
    return resolveConfigPath(options.sessionDir, { baseDir, homeDir });
  }

  const agentDir = resolveOmpAgentDir({ runtimeSettings: options.runtimeSettings, env, homeDir });

  const envSessionDir =
    options.runtimeSettings?.env?.[OMP_SESSION_DIR_ENV] ?? env[OMP_SESSION_DIR_ENV];
  if (envSessionDir?.trim()) {
    return resolveConfigPath(envSessionDir, { baseDir, homeDir });
  }

  const settingsSessionDir = await readConfiguredSessionDir({
    agentDir,
    cwd: options.cwd,
  });
  if (settingsSessionDir?.trim()) {
    return resolveConfigPath(settingsSessionDir, { baseDir, homeDir });
  }

  return path.join(agentDir, "sessions");
}

function resolveOmpAgentDir(input: {
  runtimeSettings?: ProviderRuntimeSettings;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}): string {
  const configured =
    input.runtimeSettings?.env?.[OMP_AGENT_DIR_ENV] ?? input.env[OMP_AGENT_DIR_ENV];
  if (configured?.trim()) {
    return resolveConfigPath(configured, { baseDir: process.cwd(), homeDir: input.homeDir });
  }
  return path.join(input.homeDir, OMP_CONFIG_DIR_NAME, "agent");
}

async function readConfiguredSessionDir(input: {
  agentDir: string;
  cwd: string | undefined;
}): Promise<string | null> {
  const values = await Promise.all([
    readSessionDirFromSettings(path.join(input.agentDir, "settings.json")),
    input.cwd
      ? readSessionDirFromSettings(path.join(input.cwd, OMP_CONFIG_DIR_NAME, "settings.json"))
      : null,
  ]);
  return values[1] ?? values[0] ?? null;
}

async function readSessionDirFromSettings(settingsPath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const sessionDir = Reflect.get(parsed, "sessionDir");
    return typeof sessionDir === "string" && sessionDir.trim() ? sessionDir : null;
  } catch {
    return null;
  }
}

function resolveConfigPath(value: string, options: { baseDir: string; homeDir: string }): string {
  if (value === "~") {
    return options.homeDir;
  }
  if (value.startsWith("~/")) {
    return path.join(options.homeDir, value.slice(2));
  }
  return path.isAbsolute(value) ? value : path.resolve(options.baseDir, value);
}

async function walkJsonlFiles(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return await walkJsonlFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".jsonl") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

async function rankSessionFilesByMtime(files: string[]): Promise<RankedSessionFile[]> {
  const ranked = await Promise.all(
    files.map(async (file) => {
      const mtime = await readFileMtime(file);
      return mtime ? { file, mtime } : null;
    }),
  );
  return ranked
    .filter((entry): entry is RankedSessionFile => entry !== null)
    .sort((left, right) => right.mtime.getTime() - left.mtime.getTime());
}

interface ScannedOmpSession {
  filePath: string;
  mtime: Date;
  descriptor: OmpSessionDescriptor;
}

interface OmpScanIndex {
  /** Every transcript path this scan discovered, keyed by `sessionPathKey`. */
  discovered: Set<string>;
  /** Transcripts this scan actually parsed, keyed by `sessionPathKey`. */
  parsedByKey: Map<string, OmpSessionDescriptor>;
  /** Session id -> transcript path as scanned; the first claimer of an id wins. */
  pathBySessionId: Map<string, string>;
}

interface OmpParentLink {
  parentHandleId: string;
  parentTitle?: string;
}

function toOmpImportableSession(
  row: ScannedOmpSession,
  index: OmpScanIndex,
  scannedAt: number,
): ImportableProviderSession {
  const { descriptor } = row;
  const parent = resolveOmpParentChain(row.filePath, descriptor, index);
  return {
    providerHandleId: row.filePath,
    cwd: descriptor.cwd,
    title: descriptor.title,
    firstPromptPreview: normalizePromptPreview(descriptor.firstUserMessage),
    lastPromptPreview: normalizePromptPreview(
      descriptor.lastUserMessage ?? descriptor.firstUserMessage,
    ),
    lastActivityAt: descriptor.lastActivityAt,
    looksActive: scannedAt - row.mtime.getTime() < LOOKS_ACTIVE_MTIME_WINDOW_MS,
    ...parent,
  };
}

function resolveOmpParentChain(
  filePath: string,
  descriptor: OmpSessionDescriptor,
  index: OmpScanIndex,
): OmpParentLink | null {
  // OMP links a subagent transcript to its spawner two ways: the session header's
  // cross-session `parentId`, and its nested layout, where children spawn into
  // `<parentStem>/<agentName>.jsonl`. Header first, layout as the fallback.
  const parentPath =
    (descriptor.parentId ? index.pathBySessionId.get(descriptor.parentId) : undefined) ??
    findNestedParentPath(filePath, index.discovered);
  if (parentPath === undefined) {
    // Parent transcript never entered this scan: hand back the opaque id so the
    // client can still group siblings, without inventing a path or a title.
    return descriptor.parentId ? { parentHandleId: descriptor.parentId } : null;
  }

  const parent = index.parsedByKey.get(sessionPathKey(parentPath));
  return {
    parentHandleId: parentPath,
    ...(parent?.title ? { parentTitle: parent.title } : {}),
  };
}

function findNestedParentPath(filePath: string, discovered: Set<string>): string | undefined {
  const transcriptDir = path.dirname(filePath);
  const parentStem = path.basename(transcriptDir);
  if (!parentStem) return undefined;
  const candidate = path.join(path.dirname(transcriptDir), `${parentStem}.jsonl`);
  if (sessionPathKey(candidate) === sessionPathKey(filePath)) return undefined;
  return discovered.has(sessionPathKey(candidate)) ? candidate : undefined;
}

/**
 * Key for paths that came out of the same scan. The nested-layout parent path is
 * derived from the child's spelling, which can differ in case only on
 * case-insensitive filesystems, so Windows keys fold case.
 */
export function sessionPathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return looksLikeDefiniteWindowsPath(resolved) ? resolved.toLowerCase() : resolved;
}

// B5-IMPORT2 (F17-4): an omp resume does not append to the transcript it resumes
// from — it writes a NEW file whose session header carries `parentSession`, the
// path of the file it was resumed from. A managed agent's persistence handle
// tracks only the newest file, so every ancestor in that chain used to stay a
// separate, unclaimed row on the import list (screenshot F17: the row of the
// very session the user was chatting in). Walking the chain here lets
// server/agent/import-sessions.ts claim the whole chain as one existing agent.
export async function resolveOmpResumeAncestorPaths(
  sessionFile: string,
  maxDepth = 32,
  logger?: Logger,
): Promise<string[]> {
  const ancestors: string[] = [];
  const visited = new Set<string>([sessionPathKey(sessionFile)]);
  let current = sessionFile;
  for (;;) {
    // Paths are taken verbatim from transcript content. readHeadChunk only contains
    // open() failures — handle.read() can still reject (EISDIR on a directory named
    // *.jsonl, EIO on a dead network drive) — and one bad parentSession must degrade
    // to「祖先未知」, not fail the whole import listing.
    const parent = await readOmpParentSessionPath(current);
    if (!parent) break;
    const key = sessionPathKey(parent);
    if (visited.has(key)) break;
    visited.add(key);
    // Claim only ancestors that exist: a deleted transcript never surfaces as
    // an import row, and the unreadable head also ends the walk there.
    if (!(await readHeadChunk(parent).catch(() => null))) break;
    if (ancestors.length >= maxDepth) {
      // The cap truncates silently otherwise — deeper ancestors stay unclaimed
      // (still listed as fresh imports). Make the gap observable.
      logger?.warn(
        { sessionFile, maxDepth, ancestorCount: ancestors.length },
        "OMP resume chain hit the ancestor-walk depth cap; deeper ancestors stay unclaimed",
      );
      break;
    }
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

async function readOmpParentSessionPath(
  filePath: string,
  headBytes: number = HEAD_BYTES,
): Promise<string | null> {
  const chunk = await readHeadChunk(filePath, headBytes).catch(() => null);
  if (!chunk) return null;
  for (const line of chunk.split(/\r?\n/u)) {
    const entry = parseJsonRecord(line.trim());
    if (!entry || entry.type !== "session") continue;
    // `parentSession` is the absolute transcript path omp wrote. Anything that
    // is not a .jsonl path ends the walk — deliberately so for the legacy UUID
    // form (B9-WATCH2 forensics: pre-path omp wrote bare `parentSession` UUIDs;
    // there is no path to stat, follow, or match a chain against, and guessing
    // one from the file-name suffix would invent links). A missing/unreadable
    // file is handled upstream.
    const parent = readNonEmptyString(entry.parentSession);
    return parent && parent.toLowerCase().endsWith(".jsonl") ? parent : null;
  }
  return null;
}

/**
 * B8-WATCH (F28) cost bounds for the forward walk. Unlike the ancestor walk this
 * has to look at *other* files to find the next link, and its caller is a
 * recurring watcher rather than a one-shot import listing — so one step reads at
 * most `MAX_RESUME_CHILD_HEAD_READS` headers of `RESUME_CHILD_HEAD_BYTES` each,
 * and in a directory big enough for that to matter it only looks at transcripts
 * touched at or after the parent's own last write: a file resumed FROM the parent
 * cannot predate the parent's last write.
 *
 * B9-WATCH3 (F28-KI1): the cap is a stop-on-hit CEILING, not a budget — the
 * candidates are read newest-first and the step returns at the first header
 * naming the parent, so widening 24 → 200 only costs in directories where no
 * transcript resumes from the parent at all, and buys the flooded-directory
 * case (dozens of subagent/new-session files newer than the real child used to
 * push it out of the window and the chase lost the chain for good). What keeps
 * the recurring chase cheap is the caller's chain-tail memory (`knownTail`),
 * not a small window.
 */
const RESUME_CHILD_HEAD_BYTES = 16 * 1024;
const MAX_RESUME_CHILD_HEAD_READS = 200;
/** Directories at or under this many transcripts are scanned without the filter. */
const RESUME_CHILD_MTIME_FILTER_MIN = 64;
/** Timestamp slop: a coarse mtime must not hide a same-second resume. */
const RESUME_CHILD_MTIME_SLOP_MS = 5_000;
/** Longest resume chain followed by the watcher (deeper = pathological). */
const RESUME_LEAF_CHAIN_MAX_DEPTH = 8;

export interface OmpResumeLeafChainOptions {
  maxDepth?: number;
  logger?: Logger;
  /**
   * B9-WATCH3 (chain-tail memory): the caller asserts `sessionFile` is the
   * newest link of the chain it observed last time (a watch entry's tailed
   * path). A child of it cannot predate its last write, so every step applies
   * the mtime floor UNCONDITIONALLY — the chase stats the tail's newer
   * siblings and reads headers of nothing else. A tick where no sibling is
   * newer than the tail costs one readdir + stats and ZERO header reads,
   * however many older transcripts share the directory. A tail that cannot be
   * statted (deleted mid-watch) falls back to the cold scan.
   */
  knownTail?: boolean;
}

/**
 * B8-WATCH (F28): the forward direction of the chain
 * {@link resolveOmpResumeAncestorPaths} walks backwards. `omp resume` never
 * appends to the transcript it resumes from — it forks the conversation into a
 * NEWER file in the same directory whose header carries `parentSession`. A
 * watcher that keeps tailing the file the persistence handle names therefore
 * watches a corpse: the session the user is actively writing goes silent.
 *
 * Returns the chain from `sessionFile` to its newest descendant — `[sessionFile]`
 * when nothing resumes from it, which is the common case and costs one directory
 * read. Several transcripts resuming from one parent resolve to the most recently
 * written one (that is where the writing is). A missing directory, an unreadable
 * header or a cycle ends the walk with the deepest link found: this walk is an
 * optimisation, never a failure.
 */
export async function resolveOmpResumeLeafChain(
  sessionFile: string,
  options: OmpResumeLeafChainOptions = {},
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? RESUME_LEAF_CHAIN_MAX_DEPTH;
  const chain = [sessionFile];
  const visited = new Set<string>([sessionPathKey(sessionFile)]);
  let current = sessionFile;
  const knownTail = options.knownTail === true;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    // Every step of a known-tail walk is itself a known tail: the hit below
    // becomes the remembered leaf for the next one.
    const child = await findOmpResumeChild(current, visited, knownTail);
    if (!child) {
      return chain;
    }
    visited.add(sessionPathKey(child));
    chain.push(child);
    current = child;
  }
  options.logger?.warn(
    { sessionFile, maxDepth },
    "OMP resume chain hit the leaf-walk depth cap; tailing the deepest file found",
  );
  return chain;
}

/** Direct child of `parentFile` inside its own directory, or null. */
async function findOmpResumeChild(
  parentFile: string,
  visited: Set<string>,
  knownTail: boolean,
): Promise<string | null> {
  const directory = path.dirname(parentFile);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const parentKey = sessionPathKey(parentFile);
  const siblings: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
    const file = path.join(directory, entry.name);
    const key = sessionPathKey(file);
    if (key === parentKey || visited.has(key)) continue;
    siblings.push(file);
  }
  if (siblings.length === 0) {
    return null;
  }
  const ranked = await rankSiblingFilesByMtime(siblings);
  let pool = ranked;
  // B9-WATCH3: for a remembered tail the mtime floor is unconditional — the
  // chase considers only the tail's newer siblings. A cold walk pays it only
  // once the directory is big enough for the window to matter. A tail whose
  // stat fails keeps the unfiltered (cold) pool.
  if (knownTail || ranked.length > RESUME_CHILD_MTIME_FILTER_MIN) {
    const parentMtime = await readFileMtime(parentFile);
    if (parentMtime) {
      const floor = parentMtime.getTime() - RESUME_CHILD_MTIME_SLOP_MS;
      pool = ranked.filter((entry) => entry.mtimeMs >= floor);
    }
  }
  for (const entry of pool.slice(0, MAX_RESUME_CHILD_HEAD_READS)) {
    // Stop on hit (B9-WATCH3): newest-first, the first header naming the
    // parent IS the child; the cap bounds the worst case, not the typical read.
    const parent = await readOmpParentSessionPath(entry.file, RESUME_CHILD_HEAD_BYTES);
    if (parent && sessionPathKey(parent) === parentKey) {
      return entry.file;
    }
  }
  return null;
}

/** Newest first; transcripts that cannot be stat'd (deleted mid-scan) drop out. */
interface RankedResumeSibling {
  file: string;
  mtimeMs: number;
}

async function rankSiblingFilesByMtime(files: string[]): Promise<RankedResumeSibling[]> {
  const ranked = await Promise.all(
    files.map(async (file) => {
      const mtime = await readFileMtime(file);
      return mtime ? { file, mtimeMs: mtime.getTime() } : null;
    }),
  );
  return ranked
    .filter((entry): entry is RankedResumeSibling => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

async function readOmpSessionDescriptor(filePath: string): Promise<OmpSessionDescriptor | null> {
  // OMP may emit title/session_info lines before the session header.
  const headChunk = await readHeadChunk(filePath);
  if (!headChunk) return null;
  const header = parseSessionHeaderFromChunk(headChunk);
  if (!header) return null;

  const tail = await readTail(filePath).catch(() => "");
  const tailInfo = parseSessionTail(tail);
  const headInfo = parseSessionHeadFromChunk(headChunk);
  const title =
    tailInfo.title ??
    headInfo.title ??
    readReadableSessionTitleFromPath(filePath) ??
    headInfo.firstUserMessage;
  const model = tailInfo.model ?? headInfo.model;
  const thinkingOptionId = tailInfo.thinkingOptionId ?? headInfo.thinkingOptionId;
  const lastActivityAt =
    tailInfo.lastActivityAt ?? (await readFileMtime(filePath)) ?? header.createdAt ?? new Date(0);

  return {
    sessionId: header.sessionId,
    parentId: header.parentId,
    cwd: header.cwd,
    title,
    firstUserMessage: headInfo.firstUserMessage,
    lastUserMessage: tailInfo.lastUserMessage,
    lastActivityAt,
    model,
    thinkingOptionId,
  };
}

function toOmpImportSessionConfig(descriptor: OmpSessionDescriptor): OmpImportSessionConfig {
  return {
    ...(descriptor.model ? { model: descriptor.model } : {}),
    ...(descriptor.thinkingOptionId ? { thinkingOptionId: descriptor.thinkingOptionId } : {}),
  };
}

/** First `headBytes` of a transcript, or null when it cannot be opened/read. */
async function readHeadChunk(filePath: string, headBytes = HEAD_BYTES): Promise<string | null> {
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(headBytes);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function parseSessionHeaderFromChunk(chunk: string): OmpSessionHeader | null {
  for (const line of chunk.split(/\r?\n/u)) {
    const header = parseSessionHeader(line.trim());
    if (header) return header;
  }
  return null;
}

function parseSessionHeadFromChunk(chunk: string): OmpSessionHead {
  let title: string | null = null;
  let firstUserMessage: string | null = null;
  let model: string | null = null;
  let thinkingOptionId: string | null = null;
  let lineCount = 0;

  for (const rawLine of chunk.split(/\r?\n/u)) {
    lineCount += 1;
    const entry = parseJsonRecord(rawLine.trim());
    if (!entry) continue;

    if (entry.type === "session_info") {
      title = readNonEmptyString(entry.name) ?? title;
    }
    if (entry.type === "title") {
      title = readNonEmptyString(entry.title) ?? title;
    }

    model = extractModel(entry) ?? model;
    thinkingOptionId = extractThinkingOptionId(entry) ?? thinkingOptionId;

    if (!firstUserMessage && entry.type === "message" && isRecord(entry.message)) {
      if (entry.message.role === "user") {
        firstUserMessage = extractMessageText(entry.message.content);
      }
    }

    if (title && firstUserMessage && model && thinkingOptionId) {
      break;
    }
    if (lineCount >= FULL_SCAN_LINE_LIMIT && firstUserMessage) {
      break;
    }
  }

  return { title, firstUserMessage, model, thinkingOptionId };
}

async function readTail(filePath: string): Promise<string> {
  const fileStats = await stat(filePath);
  const start = Math.max(0, fileStats.size - TAIL_BYTES);
  const length = fileStats.size - start;
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readFileMtime(filePath: string): Promise<Date | null> {
  try {
    return (await stat(filePath)).mtime;
  } catch {
    return null;
  }
}

function parseSessionHeader(firstLine: string): OmpSessionHeader | null {
  const entry = parseJsonRecord(firstLine);
  if (!entry || entry.type !== "session") return null;
  const sessionId = typeof entry.id === "string" ? entry.id : null;
  const cwd = typeof entry.cwd === "string" ? entry.cwd : null;
  if (!sessionId || !cwd) return null;
  const createdAt = parseDate(entry.timestamp);
  // OMP writes the spawning session's id here for subagent transcripts (`null` for
  // roots). Older builds omit the key entirely; the nested transcript layout then
  // carries the link.
  const parentId = readNonEmptyString(entry.parentId);
  return { sessionId, parentId, cwd, createdAt };
}

function parseSessionTail(tail: string): OmpSessionTail {
  const lines = tail.split(/\r?\n/u);
  let title: string | null = null;
  let lastActivityAt: Date | null = null;
  let fallbackTimestamp: Date | null = null;
  let lastUserMessage: string | null = null;
  let model: string | null = null;
  let thinkingOptionId: string | null = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const entry = parseJsonRecord(lines[index].trim());
    if (!entry) continue;

    if (!title && entry.type === "session_info") {
      title = readNonEmptyString(entry.name);
    }
    if (!title && entry.type === "title") {
      title = readNonEmptyString(entry.title);
    }

    if (!model) {
      model = extractModel(entry);
    }

    if (!thinkingOptionId) {
      thinkingOptionId = extractThinkingOptionId(entry);
    }

    const entryTimestamp = parseDate(entry.timestamp);
    if (!fallbackTimestamp && entryTimestamp) {
      fallbackTimestamp = entryTimestamp;
    }

    if (entry.type !== "message") continue;

    if (!lastActivityAt && entryTimestamp) {
      lastActivityAt = entryTimestamp;
    }

    if (!lastUserMessage && isRecord(entry.message) && entry.message.role === "user") {
      lastUserMessage = extractMessageText(entry.message.content);
    }
  }

  return {
    title,
    lastActivityAt: lastActivityAt ?? fallbackTimestamp,
    lastUserMessage,
    model,
    thinkingOptionId,
  };
}

function extractModel(entry: Record<string, unknown>): string | null {
  if (entry.type === "model_change") {
    // Pi records provider + modelId; OMP records a combined model string.
    return buildModelId(entry.provider, entry.modelId) ?? readNonEmptyString(entry.model);
  }

  if (entry.type === "message" && isRecord(entry.message)) {
    return buildModelId(entry.message.provider, entry.message.model);
  }

  return null;
}

function extractThinkingOptionId(entry: Record<string, unknown>): string | null {
  return entry.type === "thinking_level_change" ? readNonEmptyString(entry.thinkingLevel) : null;
}

function buildModelId(provider: unknown, modelId: unknown): string | null {
  const providerName = readNonEmptyString(provider);
  const modelName = readNonEmptyString(modelId);
  if (!providerName || !modelName) {
    return null;
  }
  return `${providerName}/${modelName}`;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePromptPreview(text: string | null): string | null {
  const normalized = text?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}

function readReadableSessionTitleFromPath(filePath: string): string | null {
  const stem = path.basename(filePath, ".jsonl").trim();
  if (!stem) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}/u.test(stem)) {
    return null;
  }
  if (/^[0-9a-f]{8,}$/iu.test(stem)) {
    return null;
  }
  return stem;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractMessageText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n\n")
    .trim();
  return text || null;
}
