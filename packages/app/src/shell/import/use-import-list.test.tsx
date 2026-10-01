// @vitest-environment jsdom
// F1 regression (review round): switching hosts while an import runs must not let
// the import's tail call the OLD host's `load` closure and overwrite the new host's
// list. The old closure grabs the newest requestSeq at call time, so the seq guard
// alone cannot stop it — the loader must also reject closures bound to a stale host.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import { useImportList, type ImportListClient } from "./use-import-list";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ENTRY_A = { id: "a-1" } as unknown as FetchRecentProviderSessionEntry;
const ENTRY_B = { id: "b-1" } as unknown as FetchRecentProviderSessionEntry;

describe("useImportList host-switch race", () => {
  it("a stale-host load closure cannot overwrite the new host's list", async () => {
    const pendingA = deferred<{ entries: FetchRecentProviderSessionEntry[] }>();
    const fetchA = vi.fn(() => pendingA.promise);
    const fetchB = vi.fn(async () => ({ entries: [ENTRY_B] }));
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const clientB = { fetchRecentProviderSessions: fetchB } as unknown as ImportListClient;

    const { result, rerender } = renderHook(
      ({ serverId, client }) => useImportList(60, serverId, client, ""),
      { initialProps: { serverId: "A", client: clientA } },
    );
    // The closure the import tail will call when it finishes on host A.
    const staleLoad = result.current.load;

    // User switches hosts mid-import: the effect loads B and B's list commits.
    rerender({ serverId: "B", client: clientB });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);

    // Import finishes; the captured A closure runs and A's response arrives.
    pendingA.resolve({ entries: [ENTRY_A] });
    await act(async () => {
      await staleLoad();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
    expect(result.current.listState.status).toBe("ready");
    // Only the mount-time load ever ran; the stale closure never fetched again.
    expect(fetchA).toHaveBeenCalledTimes(1);
  });

  it("same-host reloads still commit (guard does not eat fresh loads)", async () => {
    const fetchA = vi.fn(async () => ({ entries: [ENTRY_A] }));
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const { result } = renderHook(() => useImportList(60, "A", clientA, ""));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_A]);
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.listState.status).toBe("ready");
    expect(fetchA).toHaveBeenCalledTimes(2);
  });
});

// C23 验收 2：query 进 RPC 的口径 + query 竞态（requestSeq 覆盖 query 变化）。
describe("useImportList query pass-through", () => {
  it("sends query only when non-empty", async () => {
    const fetchA = vi.fn(async () => ({ entries: [ENTRY_A] }));
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const { rerender } = renderHook(({ query }) => useImportList(60, "A", clientA, query), {
      initialProps: { query: "" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchA).toHaveBeenCalledWith({ limit: 60, includeExisting: true });
    rerender({ query: "C13" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchA).toHaveBeenLastCalledWith({
      limit: 60,
      query: "C13",
      includeExisting: true,
    });
  });

  it("an old query's late response cannot overwrite the newest query's list", async () => {
    const pendingOld = deferred<{ entries: FetchRecentProviderSessionEntry[] }>();
    const calls: Array<{ query?: string }> = [];
    const fetchA = vi.fn((input: { limit: number; query?: string }) => {
      calls.push(input);
      return calls.length === 1 ? pendingOld.promise : Promise.resolve({ entries: [ENTRY_B] });
    });
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const { result, rerender } = renderHook(({ query }) => useImportList(60, "A", clientA, query), {
      initialProps: { query: "old" },
    });
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ query: "new" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
    // 旧 query 的响应此刻才到：seq 守卫必须丢弃它，列表保持新 query 结果。
    await act(async () => {
      pendingOld.resolve({ entries: [ENTRY_A] });
      await pendingOld.promise;
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
    expect(calls).toEqual([
      { limit: 60, query: "old", includeExisting: true },
      { limit: 60, query: "new", includeExisting: true },
    ]);
  });

  // R2-05 (FIX-A): the import tail (`runImport` → `void load()`) calls the
  // closure captured at press time. Same host, query edited mid-import: the
  // serverId-only guard passes, the closure's `++requestSeq` grabs the newest
  // slot, and the old-query response silently replaces the new-query list.
  // The guard must compare the FULL request identity (serverId+client+query+
  // limit) and reject before even fetching.
  it("a stale-query tail closure cannot overwrite the newest query's list", async () => {
    const calls: Array<{ limit: number; query?: string }> = [];
    const fetchA = vi.fn((input: { limit: number; query?: string }) => {
      calls.push(input);
      return Promise.resolve({ entries: input.query === "new" ? [ENTRY_B] : [ENTRY_A] });
    });
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const { result, rerender } = renderHook(({ query }) => useImportList(60, "A", clientA, query), {
      initialProps: { query: "old" },
    });
    // The closure the import tail will call when the import finishes.
    const staleLoad = result.current.load;
    await act(async () => {
      await Promise.resolve();
    });
    // User edits the search while the import runs: the fresh "new" list commits.
    rerender({ query: "new" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
    // Import finishes; the tail runs the press-time closure.
    await act(async () => {
      await staleLoad();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
    expect(result.current.listState.status).toBe("ready");
    // Rejected at the identity guard: the stale closure never re-fetched.
    expect(calls).toEqual([
      { limit: 60, query: "old", includeExisting: true },
      { limit: 60, query: "new", includeExisting: true },
    ]);
  });

  it("a stale-limit tail closure cannot re-fetch either (identity covers limit)", async () => {
    const fetchA = vi.fn(async () => ({ entries: [ENTRY_A] }));
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const { result, rerender } = renderHook(
      ({ limit }: { limit: number }) => useImportList(limit, "A", clientA, ""),
      { initialProps: { limit: 60 } },
    );
    const staleLoad = result.current.load;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender({ limit: 30 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await staleLoad();
    });
    // Mount load + the limit-change reload only; the stale-60 tail never fetched.
    expect(fetchA).toHaveBeenCalledTimes(2);
  });

  it("query change on a stale host still cannot fetch (host guard kept)", async () => {
    const fetchA = vi.fn(async () => ({ entries: [ENTRY_A] }));
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const { rerender } = renderHook(
      ({
        serverId,
        client,
        query,
      }: {
        serverId: string | null;
        client: ImportListClient | null;
        query: string;
      }) => useImportList(60, serverId, client, query),
      { initialProps: { serverId: "A", client: clientA as ImportListClient | null, query: "" } },
    );
    rerender({ serverId: "B", client: null, query: "new" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // A 的 client 再也不会被新 query 的 effect 触发（load 身份属于 B/null）。
    expect(fetchA).toHaveBeenCalledTimes(1);
  });
});

// KI-13: 切换即清空——serverId 变更瞬间 entries/alreadyImportedCount/providerErrors
// 全部复位进 loading 空态（状态条与列表同一台主机判定），新响应到达才再渲染。
// 与 F1 竞态守卫互补：守卫拦「迟到的旧响应落地」，清空防「已落地的旧数据残留」。
describe("useImportList host-switch clear (KI-13)", () => {
  it("switching hosts clears entries/count/errors before the new response arrives", async () => {
    const pendingB = deferred<{ entries: FetchRecentProviderSessionEntry[] }>();
    const fetchA = vi.fn(async () => ({
      entries: [ENTRY_A],
      filteredAlreadyImportedCount: 3,
      providerErrors: [{ provider: "claude", message: "boom" }],
    }));
    const fetchB = vi.fn(() => pendingB.promise);
    const clientA = { fetchRecentProviderSessions: fetchA } as unknown as ImportListClient;
    const clientB = { fetchRecentProviderSessions: fetchB } as unknown as ImportListClient;
    const { result, rerender } = renderHook(
      ({ serverId, client }) => useImportList(60, serverId, client, ""),
      { initialProps: { serverId: "A", client: clientA } },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listState.entries).toEqual([ENTRY_A]);
    expect(result.current.listState.alreadyImportedCount).toBe(3);
    expect(result.current.listState.providerErrors).toEqual([
      { provider: "claude", message: "boom" },
    ]);

    rerender({ serverId: "B", client: clientB });
    // 切换立即可见：render-phase 复位与切换同帧提交，旧主机数据零残留。
    expect(result.current.listState.status).toBe("loading");
    expect(result.current.listState.entries).toEqual([]);
    expect(result.current.listState.alreadyImportedCount).toBe(0);
    expect(result.current.listState.providerErrors).toEqual([]);
    expect(result.current.listState.error).toBeNull();

    // 新响应到达才再渲染。
    pendingB.resolve({ entries: [ENTRY_B] });
    await act(async () => {
      await pendingB.promise;
    });
    expect(result.current.listState.status).toBe("ready");
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
  });

  it("an in-flight old-host response cannot repopulate the cleared list", async () => {
    const pendingA = deferred<{ entries: FetchRecentProviderSessionEntry[] }>();
    const pendingB = deferred<{ entries: FetchRecentProviderSessionEntry[] }>();
    const clientA = {
      fetchRecentProviderSessions: vi.fn(() => pendingA.promise),
    } as unknown as ImportListClient;
    const clientB = {
      fetchRecentProviderSessions: vi.fn(() => pendingB.promise),
    } as unknown as ImportListClient;
    const { result, rerender } = renderHook(
      ({ serverId, client }) => useImportList(60, serverId, client, ""),
      { initialProps: { serverId: "A", client: clientA } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    // A 的请求已发出（过了身份守卫、await 中）；此刻用户切到 B。
    rerender({ serverId: "B", client: clientB });
    expect(result.current.listState.entries).toEqual([]);
    // A 的响应在切换之后才到：复位已推进 requestSeq，它必须被丢弃，
    // 列表保持空 loading 直到 B 的响应落地。
    await act(async () => {
      pendingA.resolve({ entries: [ENTRY_A] });
      await pendingA.promise;
    });
    expect(result.current.listState.entries).toEqual([]);
    expect(result.current.listState.status).toBe("loading");
    pendingB.resolve({ entries: [ENTRY_B] });
    await act(async () => {
      await pendingB.promise;
    });
    expect(result.current.listState.entries).toEqual([ENTRY_B]);
  });
});
