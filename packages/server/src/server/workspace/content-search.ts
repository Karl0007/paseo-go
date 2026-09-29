import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceContentSearchMatch } from "@getpaseo/protocol/messages";
import { isPathInsideRoot } from "../../utils/path.js";
import { runGitCommand } from "../../utils/run-git-command.js";
import { WORKSPACE_SEARCH_HIDDEN_DIRECTORIES } from "../../utils/directory-suggestions.js";

// Guardrails for one content-search request. The scan is a plain Node tree walk
// (no ripgrep dependency), so every bound is enforced by this module, not by a
// subprocess. All of them truncate: the response reports `truncated: true`
// whenever a bound stopped the scan, so callers never mistake a partial result
// for a total one.

// A single file larger than this is skipped outright (not partially scanned).
// Matches the editor-search convention: source files are small; anything past
// 1MB is generated data, minified bundles, or lockfiles the user did not type.
const MAX_FILE_SIZE_BYTES = 1024 * 1024;

// Total bytes read from disk per request. Bounds worst-case I/O on a large
// unignored tree (e.g. a directory with no .gitignore at all).
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

// Wall-clock deadline for the whole request, including the `git ls-files`
// ignore lookup. The daemon serves terminals and agent streams on the same
// event loop; a search must never hold it for seconds at a time.
const SCAN_TIMEOUT_MS = 5_000;

// Timeout for the git ignore lookup specifically. Failure is soft: the scan
// proceeds with only the name-based skips.
const IGNORE_LOOKUP_TIMEOUT_MS = 5_000;

// Protocol cap on returned matches (WorkspaceContentSearchRequestSchema limit
// is <= 60); the server clamps the same way so a non-conforming client cannot
// ask for more.
const MAX_MATCHES = 60;
const DEFAULT_MATCH_LIMIT = MAX_MATCHES;

// Previews are trimmed and hard-capped so one long minified line cannot bloat
// the response payload.
const PREVIEW_MAX_CHARS = 120;

// Depth cap mirrors searchDirectoryEntries (DEFAULT_MAX_DEPTH in
// utils/directory-suggestions.ts) so both search tiers cover the same tree.
const MAX_DEPTH = 12;

// Deadline checks inside a file body are amortized over this many lines;
// Date.now() per line would cost more than the substring scan itself.
const DEADLINE_CHECK_LINE_STRIDE = 256;

// Same name-based directory skips as discovery in utils/directory-suggestions.ts
// (IGNORED_DIRECTORY_NAMES there is module-private; keeping the list in sync by
// comment reference rather than widening that module's export surface). These
// stay out of content search even when a tree is not git-ignored at all.
const SKIPPED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "venv",
  "env",
  "virtualenv",
  "dist",
  "build",
  "target",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
  ".git",
]);

export interface ContentSearchOutput {
  matches: WorkspaceContentSearchMatch[];
  truncated: boolean;
  elapsedMs: number;
}

export interface SearchWorkspaceContentOptions {
  /** Absolute directory to search; results are relative to it. */
  root: string;
  /** Case-insensitive substring to look for in file bodies. */
  query: string;
  /** Match cap; clamped to MAX_MATCHES. Defaults to DEFAULT_MATCH_LIMIT. */
  limit?: number;
  // Test seams for deterministic budget/timeout coverage; production callers
  // leave them undefined and get the guardrail constants above.
  maxScanBytes?: number;
  timeoutMs?: number;
  now?: () => number;
}

interface ScanState {
  root: string;
  needle: string;
  gitIgnoredPaths: Set<string>;
  // One match past the limit distinguishes "exactly full" from "more existed";
  // finding it is what makes `truncated` honest at the limit boundary.
  cap: number;
  limit: number;
  maxScanBytes: number;
  scannedBytes: number;
  deadline: number;
  now: () => number;
  matches: WorkspaceContentSearchMatch[];
  truncated: boolean;
}

/**
 * Walks `root` (gitignore-aware, hidden/name-skipped) and returns lines whose
 * text contains `query` case-insensitively. Paths are relative to `root` with
 * "/" separators. A scan that stopped early — match limit, byte budget, or
 * deadline — reports `truncated: true`.
 */
export async function searchWorkspaceContent(
  options: SearchWorkspaceContentOptions,
): Promise<ContentSearchOutput> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (options.timeoutMs ?? SCAN_TIMEOUT_MS);
  const maxScanBytes = options.maxScanBytes ?? MAX_SCAN_BYTES;
  const requestedLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.trunc(options.limit)
      : DEFAULT_MATCH_LIMIT;
  const limit = Math.max(1, Math.min(MAX_MATCHES, requestedLimit));

  const rootInfo = await stat(options.root).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    throw new Error(`Directory not found: ${options.root}`);
  }
  const root = path.resolve(options.root);

  const needle = options.query.toLowerCase();
  if (!needle) {
    return { matches: [], truncated: false, elapsedMs: Math.max(0, now() - startedAt) };
  }

  const state: ScanState = {
    root,
    needle,
    gitIgnoredPaths: await loadGitIgnoredPaths(root),
    cap: limit + 1,
    limit,
    maxScanBytes,
    scannedBytes: 0,
    deadline,
    now,
    matches: [],
    truncated: false,
  };

  await walkDirectory(state, root, 0);

  return {
    matches: state.matches.slice(0, limit),
    truncated: state.truncated,
    elapsedMs: Math.max(0, now() - startedAt),
  };
}

async function walkDirectory(state: ScanState, directory: string, depth: number): Promise<void> {
  if (state.truncated) return;
  if (depth > MAX_DEPTH) {
    // Deeper trees exist; claiming completeness would be a lie.
    state.truncated = true;
    return;
  }

  const dirents = await readdir(directory, { withFileTypes: true }).catch(() => []);
  dirents.sort((left, right) => left.name.localeCompare(right.name));

  for (const dirent of dirents) {
    if (state.truncated) return;
    if (state.now() >= state.deadline) {
      state.truncated = true;
      return;
    }
    const childPath = path.join(directory, dirent.name);

    if (dirent.isSymbolicLink()) {
      // Symlinks can escape the root and form cycles; both searches skip them.
      continue;
    }
    if (dirent.isDirectory()) {
      if (isSkippedDirectory(state, childPath, dirent.name)) continue;
      await walkDirectory(state, childPath, depth + 1);
      continue;
    }
    if (!dirent.isFile()) continue;
    if (dirent.name.startsWith(".")) continue;
    if (isGitIgnored(state.root, childPath, state.gitIgnoredPaths)) continue;

    await scanFile(state, childPath);
  }
}

function isSkippedDirectory(state: ScanState, childPath: string, name: string): boolean {
  if (SKIPPED_DIRECTORY_NAMES.has(name)) return true;
  // Dot-directories stay out of discovery, with the same traversal allowlist the
  // filename search uses (.github, .vscode, ...).
  if (
    name.startsWith(".") &&
    !(WORKSPACE_SEARCH_HIDDEN_DIRECTORIES as readonly string[]).includes(name)
  ) {
    return true;
  }
  return isGitIgnored(state.root, childPath, state.gitIgnoredPaths);
}

async function scanFile(state: ScanState, filePath: string): Promise<void> {
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE_SIZE_BYTES) return;

    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
    state.scannedBytes += bytesRead;
    if (state.scannedBytes > state.maxScanBytes) {
      state.truncated = true;
      return;
    }

    const content = buffer.subarray(0, bytesRead);
    // NUL probe over the raw bytes: text files never contain NUL, binaries do.
    if (content.includes(0)) return;

    const lines = content.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if ((index & (DEADLINE_CHECK_LINE_STRIDE - 1)) === 0 && state.now() >= state.deadline) {
        state.truncated = true;
        return;
      }
      const line = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index];
      if (!line.toLowerCase().includes(state.needle)) continue;
      state.matches.push({
        path: toWirePath(state.root, filePath),
        line: index + 1,
        preview: truncatePreview(line),
      });
      if (state.matches.length >= state.cap) {
        // A further match existed beyond the requested limit.
        state.truncated = true;
        return;
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function truncatePreview(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > PREVIEW_MAX_CHARS ? trimmed.slice(0, PREVIEW_MAX_CHARS) : trimmed;
}

function toWirePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

// An ignored directory collapses to one entry (`git ls-files --directory`), so
// containment is decided by walking ancestors up to the root — same rule as
// isGitIgnoredPath in utils/directory-suggestions.ts.
function isGitIgnored(root: string, absolutePath: string, ignoredPaths: Set<string>): boolean {
  let candidate = absolutePath;
  while (candidate !== root && isPathInsideRoot(root, candidate)) {
    if (ignoredPaths.has(candidate)) return true;
    candidate = path.dirname(candidate);
  }
  return false;
}

async function loadGitIgnoredPaths(root: string): Promise<Set<string>> {
  try {
    const result = await runGitCommand(
      ["ls-files", "-o", "-i", "--directory", "--exclude-standard", "-z"],
      {
        cwd: root,
        envOverlay: { GIT_OPTIONAL_LOCKS: "0" },
        timeout: IGNORE_LOOKUP_TIMEOUT_MS,
      },
    );
    return new Set(
      result.stdout
        .split("\0")
        .filter(Boolean)
        .map((relativePath) => path.resolve(root, relativePath.replace(/\/$/, ""))),
    );
  } catch {
    // Not a git repository (or git is unavailable): name-based skips still apply.
    return new Set<string>();
  }
}
