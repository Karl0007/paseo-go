// KI-7 验收 2（壳侧定向单测）：能力闸识别 / 分页拼接与 hasMore / 同步态头行 /
// ref 徽标文案 / 行泳道活性推导 / requestSeq 竞态守卫。renderHook 姿势对齐
// workspace-search.test.tsx。
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HISTORY_PAGE_SIZE,
  buildSyncHeader,
  computeRowLanes,
  formatSyncHeader,
  isHistoryUnsupportedError,
  maxLaneOf,
  refBadgeLabel,
  useCommitHistory,
  type HistoryClient,
  type HistoryEntry,
} from "./commit-history";

class RpcError extends Error {
  constructor(readonly requestType: string) {
    super(`no handler for ${requestType}`);
    this.name = "DaemonRpcError";
  }
}

function entry(overrides: Partial<HistoryEntry> & { sha: string }): HistoryEntry {
  return {
    shortSha: overrides.sha.slice(0, 7),
    subject: `commit ${overrides.sha}`,
    authorName: "karl",
    dateISO: "2026-09-29T10:00:00+08:00",
    refs: [],
    lane: 0,
    topology: "dot",
    edges: [],
    laneEnds: false,
    ...overrides,
  };
}

interface PagePayload {
  isGit: boolean;
  entries: HistoryEntry[];
  hasMore: boolean;
  currentBranch: string | null;
  upstreamRef: string | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
}

function payload(entries: HistoryEntry[], hasMore: boolean): PagePayload {
  return {
    isGit: true,
    entries,
    hasMore,
    currentBranch: "main",
    upstreamRef: "refs/remotes/origin/main",
    aheadOfOrigin: 2,
    behindOfOrigin: 1,
    hasRemote: true,
  };
}

describe("isHistoryUnsupportedError", () => {
  it("fires only for the history request type", () => {
    expect(isHistoryUnsupportedError(new RpcError("checkout.history.list.request"))).toBe(true);
    expect(isHistoryUnsupportedError(new RpcError("workspace.content_search.request"))).toBe(false);
    expect(isHistoryUnsupportedError(new Error("timeout"))).toBe(false);
  });
});

describe("sync header", () => {
  it("renders the 卡口径 `main ⇅ origin/main ↑2 ↓1` line", () => {
    const header = buildSyncHeader({
      currentBranch: "main",
      upstreamRef: "refs/remotes/origin/main",
      aheadOfOrigin: 2,
      behindOfOrigin: 1,
      hasRemote: true,
    });
    expect(header && formatSyncHeader(header)).toBe("main ⇅ origin/main ↑2 ↓1");
  });

  it("drops zero arrows and reads branch-only without an upstream", () => {
    const synced = buildSyncHeader({
      currentBranch: "dev",
      upstreamRef: "refs/remotes/origin/dev",
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
    });
    expect(synced && formatSyncHeader(synced)).toBe("dev ⇅ origin/dev");
    const local = buildSyncHeader({
      currentBranch: "exp",
      upstreamRef: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
    });
    expect(local && formatSyncHeader(local)).toBe("exp");
  });

  it("labels detached HEAD and classifies badge kinds", () => {
    const detached = buildSyncHeader({
      currentBranch: null,
      upstreamRef: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
    });
    expect(detached && formatSyncHeader(detached)).toBe("HEAD");
    expect(refBadgeLabel({ name: "main", kind: "head" })).toBe("HEAD → main");
    expect(refBadgeLabel({ name: "HEAD", kind: "head" })).toBe("HEAD");
    expect(refBadgeLabel({ name: "origin/main", kind: "remote" })).toBe("origin/main");
    expect(refBadgeLabel({ name: "v1.0", kind: "tag" })).toBe("v1.0");
  });
});

describe("computeRowLanes", () => {
  it("keeps a plain lane alive across rows and ends it at laneEnds", () => {
    const rows = computeRowLanes([entry({ sha: "c2" }), entry({ sha: "c1", laneEnds: true })]);
    expect(rows[0]).toEqual({ above: [], below: [0] });
    expect(rows[1]).toEqual({ above: [0], below: [] });
  });

  it("opens fork lanes below the merge and closes merge edges at the dot", () => {
    const rows = computeRowLanes([
      entry({ sha: "M", topology: "merge", edges: [{ fromLane: 0, toLane: 1, kind: "fork" }] }),
      entry({ sha: "f", lane: 1 }),
      entry({ sha: "root", edges: [{ fromLane: 1, toLane: 0, kind: "merge" }], laneEnds: true }),
    ]);
    expect(rows[0]).toEqual({ above: [], below: [0, 1] });
    expect(rows[1]).toEqual({ above: [0, 1], below: [0, 1] });
    expect(rows[2]).toEqual({ above: [0, 1], below: [] });
    expect(maxLaneOf([entry({ sha: "x", lane: 2 })])).toBe(2);
  });
});

describe("useCommitHistory", () => {
  function clientWith(...pages: Array<{ entries: HistoryEntry[]; hasMore: boolean }>) {
    const calls: Array<{ cwd: string; limit?: number; skip?: number }> = [];
    let page = 0;
    const client: HistoryClient = {
      listCheckoutHistory: vi.fn(async (options) => {
        calls.push(options);
        const next = pages[Math.min(page, pages.length - 1)] as {
          entries: HistoryEntry[];
          hasMore: boolean;
        };
        page += 1;
        return payload(next.entries, next.hasMore);
      }),
    };
    return { client, calls };
  }

  it("pages: first page then loadMore appends with skip=entries.length", async () => {
    const { client, calls } = clientWith(
      { entries: [entry({ sha: "a" })], hasMore: true },
      { entries: [entry({ sha: "b" })], hasMore: false },
    );
    const { result } = renderHook(() =>
      useCommitHistory({ serverId: "srv", client, cwd: "F:/Gd/IdleGame" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.entries.map((item) => item.sha)).toEqual(["a"]);
    expect(result.current.hasMore).toBe(true);
    expect(calls[0]).toEqual({
      cwd: "F:/Gd/IdleGame",
      limit: HISTORY_PAGE_SIZE,
      skip: 0,
    });

    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });
    expect(result.current.entries.map((item) => item.sha)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(false);
    expect(calls[1]?.skip).toBe(1);

    // Exhausted: a third call is a no-op.
    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });
    expect(calls).toHaveLength(2);
  });

  it("trips the capability gate on the history rpc_error only", async () => {
    const client: HistoryClient = {
      listCheckoutHistory: vi.fn().mockRejectedValue(new RpcError("checkout.history.list.request")),
    };
    const { result } = renderHook(() =>
      useCommitHistory({ serverId: "srv", client, cwd: "/repo" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.unsupported).toBe(true);
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("marks transient failures retryable and refetches from zero", async () => {
    const client: HistoryClient = {
      listCheckoutHistory: vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue(payload([entry({ sha: "a" })], false)),
    };
    const { result } = renderHook(() =>
      useCommitHistory({ serverId: "srv", client, cwd: "/repo" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.failed).toBe(true);
    expect(result.current.entries).toEqual([]);

    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    expect(result.current.failed).toBe(false);
    expect(result.current.entries.map((item) => item.sha)).toEqual(["a"]);
  });

  it("drops a superseded response (cwd switch mid-flight)", async () => {
    let resolveFirst: ((value: PagePayload) => void) | null = null;
    const client: HistoryClient = {
      listCheckoutHistory: vi.fn((options: { cwd: string }) =>
        options.cwd === "/old"
          ? new Promise<PagePayload>((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve(payload([entry({ sha: "new" })], false)),
      ),
    };
    const { result, rerender } = renderHook(
      ({ cwd }: { cwd: string }) => useCommitHistory({ serverId: "srv", client, cwd }),
      { initialProps: { cwd: "/old" } },
    );
    rerender({ cwd: "/repo" });
    await act(async () => {
      resolveFirst?.(payload([entry({ sha: "stale" })], false));
      await Promise.resolve();
    });
    expect(result.current.entries.map((item) => item.sha)).toEqual(["new"]);
  });
});
