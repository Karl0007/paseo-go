// 全量提交历史 + Git Graph 式 DAG 泳道 (Paseo Go KI-7, 用户二轮拍板 2026-09-29).
//
// The shell draws, this module computes: `checkout.history.list` walks HEAD's
// full history in topological order and hands every entry precomputed lane
// geometry (lane / topology / edges), so the react-native-svg column in the
// app is a dumb renderer. Lane allocation is a pure function of the commit
// sequence walked from HEAD — every page re-walks its own prefix, so lane
// numbers are identical no matter which page a row is requested with.
//
// The card's sketch suggested parsing `git log --graph` ASCII columns. That is
// deliberately NOT what this does: git re-allocates graph columns per
// invocation, so with `--skip` paging each page would get its own numbering and
// the shell's lanes would jump between pages. Instead we read `%P` (parents)
// and implement the simplified Git Graph commit-lane rule the card names as
// the normative algorithm: HEAD's mainline is lane 0, a branch gets a fresh
// lane at first sight, merges converge with cross-lane curves.
//
// Zero new dependencies: one `git log` plus four cheap read-only plumbing
// queries through the repo's shared runGitCommand scheduler.
import type {
  CheckoutHistoryEdge,
  CheckoutHistoryEntry,
  CheckoutHistoryListRequest,
  CheckoutHistoryRef,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { expandTilde } from "../../utils/path.js";
import { runGitCommand } from "../../utils/run-git-command.js";
import { resolveCheckoutGitDir, toCheckoutError } from "../checkout-git-utils.js";

// Protocol cap (CheckoutHistoryListRequestSchema limit <=200); the server
// clamps identically so a non-conforming client cannot ask for more.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Upper bound on commits walked per request (page window + one probe row).
// Deep pages re-walk from HEAD to keep lane numbering stable, so the walk —
// not the page — is what this bounds. A walk that hits the cap reports
// hasMore=false: pagination stops rather than silently mis-numbering lanes.
const MAX_WALK = 10_000;

// `git log` on a huge repo can legitimately take seconds; the plumbing probes
// are millisecond-cheap and get a tighter budget.
const LOG_TIMEOUT_MS = 15_000;
const SYNC_TIMEOUT_MS = 5_000;

// Field layout: unit separator between fields, one record per line (tformat
// terminates every record). %s is single-line by construction; %D carries the
// decorate tokens; %P lists space-separated parent shas.
const FIELD_SEPARATOR = "\x1f";
const PRETTY_FORMAT = ["%H", "%h", "%an", "%ad", "%s", "%D", "%P"].join(`%x1f`);

interface RawCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  dateISO: string;
  subject: string;
  refs: CheckoutHistoryRef[];
  parents: string[];
}

interface LaneGeometry {
  lane: number;
  topology: CheckoutHistoryEntry["topology"];
  edges: CheckoutHistoryEdge[];
  laneEnds: boolean;
}

export interface CommitHistoryCore {
  isGit: boolean;
  entries: CheckoutHistoryEntry[];
  hasMore: boolean;
  currentBranch: string | null;
  upstreamRef: string | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
}

/**
 * Parse a `%D` `--decorate=full` token list into display refs.
 *
 * Observed token shapes (git >= 2.40):
 *   `HEAD -> refs/heads/main`        — head on a branch
 *   `HEAD`                           — detached head
 *   `refs/heads/other`               — another local branch tip
 *   `refs/remotes/origin/main`       — remote tip
 *   `tag: refs/tags/v1.0`            — annotated tag ("tag: " prefix even with
 *                                      decorate=full; peel suffixes `: <oid>`
 *                                      are trimmed)
 *   `refs/tags/lw`                   — lightweight tag
 * Unknown tokens (`grafted`, `replace: ...`) are ignored. A ref name may
 * legitimately contain a comma; splitting on ", " follows what git itself
 * prints and what every other consumer parses.
 */
export function parseDecorateRefs(decorate: string): CheckoutHistoryRef[] {
  const trimmed = decorate.trim();
  if (trimmed.length === 0) return [];
  const refs: CheckoutHistoryRef[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: CheckoutHistoryRef["kind"]): void => {
    const key = `${kind}\u0000${name}`;
    if (seen.has(key) || name.length === 0) return;
    seen.add(key);
    refs.push({ name, kind });
  };
  for (const rawToken of trimmed.split(", ")) {
    const token = rawToken.trim();
    if (token.startsWith("HEAD -> ")) {
      const target = token.slice("HEAD -> ".length);
      // The head badge names the branch HEAD points at; the refs/heads/
      // prefix is display noise ("HEAD → main", not "HEAD → refs/heads/main").
      push(target.replace(/^refs\/heads\//, ""), "head");
    } else if (token === "HEAD") {
      push("HEAD", "head");
    } else if (token.startsWith("tag: refs/tags/")) {
      push(stripPeel(token.slice("tag: refs/tags/".length)), "tag");
    } else if (token.startsWith("refs/tags/")) {
      push(stripPeel(token.slice("refs/tags/".length)), "tag");
    } else if (token.startsWith("refs/remotes/")) {
      push(token.slice("refs/remotes/".length), "remote");
    } else if (token.startsWith("refs/heads/")) {
      push(token.slice("refs/heads/".length), "local");
    }
  }
  return refs;
}

/** `v1.0: refs/tags/v1.0^{commit}`-style peel suffixes are not part of the name. */
function stripPeel(tagName: string): string {
  const peel = tagName.indexOf(": ");
  return (peel >= 0 ? tagName.slice(0, peel) : tagName).trim();
}

/** Parse the whole `git log --pretty=tformat:...` stdout into raw commits. */
export function parseHistoryRecords(stdout: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split(FIELD_SEPARATOR);
    if (fields.length < 7) continue; // defensive: never trust partial records
    const [sha, shortSha, authorName, dateISO, subject, decorate, parents] = fields;
    commits.push({
      sha: sha ?? "",
      shortSha: shortSha ?? "",
      authorName: authorName ?? "",
      dateISO: dateISO ?? "",
      subject: subject ?? "",
      refs: parseDecorateRefs(decorate ?? ""),
      parents: (parents ?? "").trim().length > 0 ? (parents ?? "").trim().split(/\s+/) : [],
    });
  }
  return commits;
}

/**
 * Simplified Git Graph commit-lane assignment over the walked prefix.
 *
 * `lanes[i] === sha` means lane i is descending and expects commit `sha` next;
 * `null` is a free slot (reused first, keeping lane numbers compact). For each
 * commit in log order:
 *  - lanes expecting it converge: lowest lane wins the dot, the others close
 *    with a `merge` edge curving into the dot (branch-point rows);
 *  - nobody expecting it (HEAD, shallow/orphan boundary) takes a fresh lane;
 *  - the first parent inherits the commit's lane; extra parents join an
 *    existing lane or open a fresh one, each with a `fork` edge leaving the dot.
 *
 * topology: "merge" = >=2 parents; "edge" = single-parent commit where a lane
 * converges (the branch point itself); "dot" = plain pass-through.
 */
export function assignLaneGeometry(commits: readonly RawCommit[]): LaneGeometry[] {
  const lanes: (string | null)[] = [];
  const geometry: LaneGeometry[] = [];
  const allocateLane = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    return lanes.length - 1;
  };
  for (const commit of commits) {
    const expected: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === commit.sha) expected.push(i);
    }
    let lane: number;
    const edges: CheckoutHistoryEdge[] = [];
    if (expected.length > 0) {
      lane = Math.min(...expected);
      for (const other of expected) {
        if (other === lane) continue;
        lanes[other] = null;
        edges.push({ fromLane: other, toLane: lane, kind: "merge" });
      }
    } else {
      lane = allocateLane();
    }
    lanes[lane] = null;
    let laneEnds = false;
    if (commit.parents.length === 0) {
      laneEnds = true;
    } else {
      lanes[lane] = commit.parents[0] ?? null;
      if (lanes[lane] === null) laneEnds = true;
      for (const parent of commit.parents.slice(1)) {
        const existing = lanes.indexOf(parent);
        if (existing >= 0) {
          edges.push({ fromLane: lane, toLane: existing, kind: "fork" });
          continue;
        }
        const fresh = allocateLane();
        lanes[fresh] = parent;
        edges.push({ fromLane: lane, toLane: fresh, kind: "fork" });
      }
    }
    let topology: LaneGeometry["topology"] = "dot";
    if (commit.parents.length >= 2) {
      topology = "merge";
    } else if (edges.some((edge) => edge.kind === "merge")) {
      topology = "edge";
    }
    geometry.push({ lane, topology, edges, laneEnds });
  }
  return geometry;
}

function toEntry(commit: RawCommit, geometry: LaneGeometry): CheckoutHistoryEntry {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    authorName: commit.authorName,
    dateISO: commit.dateISO,
    refs: commit.refs,
    lane: geometry.lane,
    topology: geometry.topology,
    edges: geometry.edges,
    laneEnds: geometry.laneEnds,
  };
}

/** Branch/remote sync state — the same facts checkout_status publishes. */
async function readSyncState(
  cwd: string,
): Promise<Omit<CommitHistoryCore, "isGit" | "entries" | "hasMore">> {
  const [branch, upstream, remote] = await Promise.all([
    runGitCommand(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd,
      timeout: SYNC_TIMEOUT_MS,
      acceptExitCodes: [0, 1, 128],
    }),
    runGitCommand(["rev-parse", "--symbolic-full-name", "@{upstream}"], {
      cwd,
      timeout: SYNC_TIMEOUT_MS,
      acceptExitCodes: [0, 128],
    }),
    runGitCommand(["remote"], { cwd, timeout: SYNC_TIMEOUT_MS, acceptExitCodes: [0, 128] }),
  ]);
  const currentBranch = branch.exitCode === 0 ? branch.stdout.trim() || null : null;
  const upstreamRef = upstream.exitCode === 0 ? upstream.stdout.trim() || null : null;
  let aheadOfOrigin: number | null = null;
  let behindOfOrigin: number | null = null;
  if (upstreamRef) {
    const counts = await runGitCommand(
      ["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`],
      { cwd, timeout: SYNC_TIMEOUT_MS, acceptExitCodes: [0, 128] },
    );
    if (counts.exitCode === 0) {
      const [ahead, behind] = counts.stdout.trim().split(/\s+/);
      const aheadValue = Number.parseInt(ahead ?? "", 10);
      const behindValue = Number.parseInt(behind ?? "", 10);
      aheadOfOrigin = Number.isFinite(aheadValue) ? aheadValue : null;
      behindOfOrigin = Number.isFinite(behindValue) ? behindValue : null;
    }
  }
  return {
    currentBranch,
    upstreamRef,
    aheadOfOrigin,
    behindOfOrigin,
    hasRemote: remote.exitCode === 0 && remote.stdout.trim().length > 0,
  };
}

const EMPTY_SYNC_STATE = {
  currentBranch: null,
  upstreamRef: null,
  aheadOfOrigin: null,
  behindOfOrigin: null,
  hasRemote: false,
} as const;

/**
 * One paged, lane-numbered slice of HEAD's full history plus the sync facts
 * for the header row. Non-git directories answer `{isGit:false, entries:[]}`;
 * a git repo without commits yet answers `{isGit:true, entries:[]}`.
 */
export async function listCommitHistory(params: {
  cwd: string;
  limit?: number | undefined;
  skip?: number | undefined;
}): Promise<CommitHistoryCore> {
  const cwd = params.cwd;
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const skip = Math.max(params.skip ?? 0, 0);
  const maxCount = Math.min(skip + limit + 1, MAX_WALK);

  const [log, sync] = await Promise.all([
    runGitCommand(
      [
        "log",
        "HEAD",
        "--topo-order",
        "--date=iso-strict",
        "--decorate=full",
        "--no-color",
        `--pretty=tformat:${PRETTY_FORMAT}`,
        `--max-count=${String(maxCount)}`,
      ],
      { cwd, timeout: LOG_TIMEOUT_MS, acceptExitCodes: [0, 128] },
    ),
    readSyncState(cwd).catch(() => ({ ...EMPTY_SYNC_STATE })),
  ]);

  if (log.exitCode !== 0) {
    // Exit 128 covers both "not a git repository" and "HEAD does not exist"
    // (empty repo). The git-dir probe tells them apart; anything else is a
    // real failure and must stay visible to the caller.
    if ((await resolveCheckoutGitDir(cwd)) === null) {
      return { isGit: false, entries: [], hasMore: false, ...EMPTY_SYNC_STATE };
    }
    return { isGit: true, entries: [], hasMore: false, ...sync };
  }
  if (log.truncated) {
    throw new Error(`git log output exceeded the byte budget for ${cwd}`);
  }

  const walked = parseHistoryRecords(log.stdout);
  // Lanes are assigned over the whole walked prefix, then the requested window
  // is sliced out — the walk order is deterministic (--topo-order), so page N
  // always agrees with page N-1 about which branch owns which column.
  const geometry = assignLaneGeometry(walked);
  const window = walked.slice(skip, skip + limit);
  const entries = window.map((commit, index) =>
    toEntry(commit, geometry[skip + index] as LaneGeometry),
  );
  return {
    isGit: true,
    entries,
    hasMore: walked.length > skip + window.length && window.length > 0,
    ...sync,
  };
}

export interface CommitHistoryHost {
  emit(msg: SessionOutboundMessage): void;
}

/** session.ts dispatch target: run the query, emit the response, never throw. */
export async function handleCheckoutHistoryListRequest(
  host: CommitHistoryHost,
  msg: CheckoutHistoryListRequest,
): Promise<void> {
  const { cwd, requestId } = msg;
  try {
    const core = await listCommitHistory({
      cwd: expandTilde(cwd),
      limit: msg.limit,
      skip: msg.skip,
    });
    host.emit({
      type: "checkout.history.list.response",
      payload: { cwd, ...core, error: null, requestId },
    });
  } catch (error) {
    host.emit({
      type: "checkout.history.list.response",
      payload: {
        cwd,
        isGit: false,
        entries: [],
        hasMore: false,
        ...EMPTY_SYNC_STATE,
        error: toCheckoutError(error),
        requestId,
      },
    });
  }
}
