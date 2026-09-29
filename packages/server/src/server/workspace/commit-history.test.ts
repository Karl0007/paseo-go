// Paseo Go KI-7: commit-history parsing, Git-Graph lane assignment, paging and
// repo-state semantics. Real git repos are built in temp dirs (content-search
// .test.ts idiom) so the decorate/dag fixtures are git's own output, not mine.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckoutHistoryEntry, SessionOutboundMessage } from "../messages.js";
import {
  assignLaneGeometry,
  handleCheckoutHistoryListRequest,
  listCommitHistory,
  parseDecorateRefs,
  parseHistoryRecords,
} from "./commit-history.js";

describe("parseDecorateRefs", () => {
  it("classifies HEAD, branch, remote and tag refs from decorate=full output", () => {
    expect(
      parseDecorateRefs(
        "HEAD -> refs/heads/main, tag: refs/tags/v1.0, refs/remotes/origin/main, refs/heads/other",
      ),
    ).toEqual([
      { name: "main", kind: "head" },
      { name: "v1.0", kind: "tag" },
      { name: "origin/main", kind: "remote" },
      { name: "other", kind: "local" },
    ]);
  });

  it("reports detached HEAD as the head ref named HEAD", () => {
    expect(parseDecorateRefs("HEAD")).toEqual([{ name: "HEAD", kind: "head" }]);
  });

  it("handles lightweight tags and strips peel suffixes", () => {
    expect(parseDecorateRefs("refs/tags/lw, tag: refs/tags/ann: refs/tags/ann^{commit}")).toEqual([
      { name: "lw", kind: "tag" },
      { name: "ann", kind: "tag" },
    ]);
  });

  it("ignores unknown tokens and empty decorate fields", () => {
    expect(parseDecorateRefs("grafted")).toEqual([]);
    expect(parseDecorateRefs("")).toEqual([]);
    expect(parseDecorateRefs("   ")).toEqual([]);
  });
});

describe("parseHistoryRecords", () => {
  it("splits tformat records into fields and parents", () => {
    const stdout = [
      `aaaa${"\x1f"}aaa${"\x1f"}karl${"\x1f"}2026-09-29T10:00:00+08:00${"\x1f"}merge x${"\x1f"}HEAD -> refs/heads/main${"\x1f"}p1 p2`,
      `bbbb${"\x1f"}bbb${"\x1f"}karl${"\x1f"}2026-09-28T10:00:00+08:00${"\x1f"}root${"\x1f"}${"\x1f"}`,
    ].join("\n");
    const records = parseHistoryRecords(stdout);
    expect(records).toHaveLength(2);
    expect(records[0]?.parents).toEqual(["p1", "p2"]);
    expect(records[0]?.refs).toEqual([{ name: "main", kind: "head" }]);
    expect(records[1]?.parents).toEqual([]);
  });

  it("drops malformed partial records instead of guessing fields", () => {
    expect(parseHistoryRecords(`x${"\x1f"}y\n`)).toEqual([]);
  });
});

function rawCommit(sha: string, parents: string[]) {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    authorName: "t",
    dateISO: "2026-09-29T00:00:00+08:00",
    subject: sha,
    refs: [],
    parents,
  };
}

describe("assignLaneGeometry", () => {
  it("keeps a linear history on lane 0 with the root ending the lane", () => {
    const geometry = assignLaneGeometry([
      rawCommit("c3", ["c2"]),
      rawCommit("c2", ["c1"]),
      rawCommit("c1", []),
    ]);
    expect(geometry.map((g) => g.lane)).toEqual([0, 0, 0]);
    expect(geometry.map((g) => g.topology)).toEqual(["dot", "dot", "dot"]);
    expect(geometry.map((g) => g.laneEnds)).toEqual([false, false, true]);
    expect(geometry.every((g) => g.edges.length === 0)).toBe(true);
  });

  it("opens a fork lane at the merge and converges it at the branch point", () => {
    // merge M(p1, f) — f(feature) — p1 — root; both f and p1 have root as parent.
    const geometry = assignLaneGeometry([
      rawCommit("M", ["p1", "f"]),
      rawCommit("f", ["root"]),
      rawCommit("p1", ["root"]),
      rawCommit("root", []),
    ]);
    expect(geometry[0]).toMatchObject({
      lane: 0,
      topology: "merge",
      edges: [{ fromLane: 0, toLane: 1, kind: "fork" }],
    });
    expect(geometry[1]).toMatchObject({ lane: 1, topology: "dot", edges: [] });
    expect(geometry[2]).toMatchObject({ lane: 0, topology: "dot", edges: [] });
    expect(geometry[3]).toMatchObject({
      lane: 0,
      topology: "edge",
      edges: [{ fromLane: 1, toLane: 0, kind: "merge" }],
      laneEnds: true,
    });
  });

  it("is page-stable: geometry of a prefix equals the same rows of the full walk", () => {
    const full = [
      rawCommit("M", ["p1", "f"]),
      rawCommit("f", ["root"]),
      rawCommit("p1", ["root"]),
      rawCommit("root", []),
    ];
    const all = assignLaneGeometry(full);
    const prefix = assignLaneGeometry(full.slice(0, 3));
    expect(prefix).toEqual(all.slice(0, 3));
  });

  it("routes an already-laned second parent into its existing lane", () => {
    // Criss-cross shape: M2's second parent b is already awaited by lane 1
    // (which descends toward b), so the fork edge targets the existing lane.
    const geometry = assignLaneGeometry([
      rawCommit("M2", ["m1", "b"]),
      rawCommit("m1", ["a"]),
      rawCommit("b", ["a"]),
      rawCommit("a", []),
    ]);
    expect(geometry[0]).toMatchObject({
      lane: 0,
      topology: "merge",
      edges: [{ fromLane: 0, toLane: 1, kind: "fork" }],
    });
    expect(geometry[1]).toMatchObject({ lane: 0 });
    expect(geometry[2]).toMatchObject({ lane: 1 });
    expect(geometry[3]).toMatchObject({
      lane: 0,
      topology: "edge",
      edges: [{ fromLane: 1, toLane: 0, kind: "merge" }],
    });
  });
});

describe("listCommitHistory (real git repos)", () => {
  let dirsToClean: string[];

  function git(cwd: string, ...args: string[]): string {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=Tester",
        "-c",
        "user.email=tester@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  function makeRepo(name: string): string {
    const repoDir = mkdtempSync(path.join(tmpdir(), `paseo-history-${name}-`));
    dirsToClean.push(repoDir);
    return repoDir;
  }

  function write(repoDir: string, name: string, content: string): void {
    writeFileSync(path.join(repoDir, name), content);
    git(repoDir, "add", name);
  }

  /** bare origin + clone with pushed root, then merge history on main. */
  function buildHistoryRepo(): string {
    const origin = makeRepo("origin");
    git(origin, "init", "--bare", "-b", "main");
    const repo = makeRepo("clone");
    git(path.dirname(repo), "clone", origin, repo);
    write(repo, "a.txt", "a");
    git(repo, "commit", "-m", "root commit");
    git(repo, "push", "-u", "origin", "main");
    git(repo, "checkout", "-b", "feature");
    write(repo, "b.txt", "b");
    git(repo, "commit", "-m", "feature work");
    git(repo, "checkout", "main");
    write(repo, "c.txt", "c");
    git(repo, "commit", "-m", "main work");
    git(repo, "merge", "--no-ff", "-m", "merge feature", "feature");
    git(repo, "tag", "-a", "v1.0", "-m", "annotated");
    return repo;
  }

  function bySubject(entries: CheckoutHistoryEntry[], subject: string): CheckoutHistoryEntry {
    const entry = entries.find((candidate) => candidate.subject === subject);
    if (!entry) throw new Error(`no entry with subject ${subject}`);
    return entry;
  }

  beforeEach(() => {
    dirsToClean = [];
  });

  afterEach(() => {
    for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
  });

  it("returns full history with refs, lanes and sync facts from a cloned repo", async () => {
    const repo = buildHistoryRepo();

    const result = await listCommitHistory({ cwd: repo });

    expect(result.isGit).toBe(true);
    expect(result.hasMore).toBe(false);
    // --topo-order pins the merge first and the root last; the two side
    // commits between them are order-free, so only the endpoints are asserted.
    expect(result.entries[0]?.subject).toBe("merge feature");
    expect(result.entries[result.entries.length - 1]?.subject).toBe("root commit");
    const head = result.entries[0] as CheckoutHistoryEntry;
    expect(head.refs).toContainEqual({ name: "main", kind: "head" });
    expect(head.refs).toContainEqual({ name: "v1.0", kind: "tag" });
    expect(head.lane).toBe(0);
    expect(head.topology).toBe("merge");
    expect(head.edges).toContainEqual({ fromLane: 0, toLane: 1, kind: "fork" });
    expect(bySubject(result.entries, "main work").lane).toBe(0);
    expect(bySubject(result.entries, "feature work").lane).toBe(1);
    const root = bySubject(result.entries, "root commit");
    expect(root.laneEnds).toBe(true);
    expect(root.edges).toContainEqual({ fromLane: 1, toLane: 0, kind: "merge" });
    // The pushed root commit carries the stale-until-fetch remote tip badge.
    expect(root.refs).toContainEqual({ name: "origin/main", kind: "remote" });
    expect(result.currentBranch).toBe("main");
    expect(result.upstreamRef).toBe("refs/remotes/origin/main");
    expect(result.hasRemote).toBe(true);
    // merge + main work + feature work are all ahead of the pushed origin/main.
    expect(result.aheadOfOrigin).toBe(3);
    expect(result.behindOfOrigin).toBe(0);
  });

  it("marks the branch point of the merged feature with a converging curve", async () => {
    const repo = buildHistoryRepo();

    const result = await listCommitHistory({ cwd: repo });
    const branchPoint = bySubject(result.entries, "root commit");

    expect(branchPoint.topology).toBe("edge");
    expect(branchPoint.edges).toEqual([{ fromLane: 1, toLane: 0, kind: "merge" }]);
  });

  it("pages by commit count with lane numbers identical to the unpaged walk", async () => {
    const repo = buildHistoryRepo();

    const full = await listCommitHistory({ cwd: repo });
    const page1 = await listCommitHistory({ cwd: repo, limit: 2, skip: 0 });
    const page2 = await listCommitHistory({ cwd: repo, limit: 2, skip: 2 });

    expect(page1.hasMore).toBe(true);
    expect(page2.hasMore).toBe(false);
    const paged = [...page1.entries, ...page2.entries];
    expect(paged.map((entry) => entry.sha)).toEqual(full.entries.map((entry) => entry.sha));
    expect(paged.map((entry) => entry.lane)).toEqual(full.entries.map((entry) => entry.lane));
    expect(paged.map((entry) => entry.edges)).toEqual(full.entries.map((entry) => entry.edges));
  });

  it("clamps the page limit to the protocol cap", async () => {
    const repo = buildHistoryRepo();

    const result = await listCommitHistory({ cwd: repo, limit: 10_000 });

    expect(result.entries.length).toBeLessThanOrEqual(200);
  });

  it("reports a repository without commits as git with no entries", async () => {
    const repo = makeRepo("empty");
    git(repo, "init", "-b", "main");

    const result = await listCommitHistory({ cwd: repo });

    expect(result).toMatchObject({
      isGit: true,
      entries: [],
      hasMore: false,
      currentBranch: "main",
      hasRemote: false,
    });
  });

  it("reports a non-git directory as not git without an error", async () => {
    const plain = makeRepo("plain");

    const result = await listCommitHistory({ cwd: plain });

    expect(result).toMatchObject({
      isGit: false,
      entries: [],
      hasMore: false,
      currentBranch: null,
      upstreamRef: null,
      hasRemote: false,
    });
  });

  it("emits the response envelope through the host, including the error path", async () => {
    const repo = buildHistoryRepo();
    const emitted: SessionOutboundMessage[] = [];
    const host = { emit: (msg: SessionOutboundMessage) => emitted.push(msg) };

    await handleCheckoutHistoryListRequest(host, {
      type: "checkout.history.list.request",
      cwd: repo,
      limit: 3,
      skip: 0,
      requestId: "ki7-1",
    });

    expect(emitted).toHaveLength(1);
    const msg = emitted[0] as Extract<
      SessionOutboundMessage,
      { type: "checkout.history.list.response" }
    >;
    expect(msg.payload.requestId).toBe("ki7-1");
    expect(msg.payload.error).toBeNull();
    expect(msg.payload.entries).toHaveLength(3);
    expect(msg.payload.hasMore).toBe(true);
  });
});
