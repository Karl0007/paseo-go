// KI-6 验收 2（壳侧定向单测）：两层搜索的结果映射 / 能力闸 / Tier-1 失败降级 /
// requestSeq 竞态守卫。renderHook 姿势对齐 use-import-list.test.tsx；debounce 用
// fake timers 推进（300ms 卡口径），RPC 用 deferred 手动放行以精确制造竞态窗口。
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchSource } from "./file-search";
import {
  CONTENT_SEARCH_LIMIT,
  NAME_SEARCH_LIMIT,
  WORKSPACE_SEARCH_DEBOUNCE_MS,
  isContentSearchUnsupportedError,
  mapContentHits,
  mapSuggestionHits,
  useWorkspaceSearch,
  type WorkspaceSearchClient,
  type WorkspaceSearchContext,
} from "./workspace-search";

interface Gate<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CTX: WorkspaceSearchContext = {
  serverId: "srv-1",
  hostLabel: "工作站",
  workspaceId: "ws-1",
  workspaceName: "IdleGame",
  workspaceRoot: "F:/Gd/IdleGame",
};

function sourceWith(...paths: string[]): FileSearchSource {
  return {
    ...CTX,
    entries: paths.map((path) => ({
      name: path.split("/").pop() ?? path,
      path,
      kind: "file" as const,
    })),
  };
}

interface NamePayload {
  entries: { path: string; kind: "file" | "directory" }[];
  error: string | null;
}
interface ContentPayload {
  matches: { path: string; line: number; preview: string }[];
  truncated: boolean;
}

function makeClient() {
  const nameCalls: Gate<NamePayload>[] = [];
  const contentCalls: Gate<ContentPayload>[] = [];
  const client: WorkspaceSearchClient = {
    getDirectorySuggestions: vi.fn(() => {
      const gate = deferred<NamePayload>();
      nameCalls.push(gate);
      return gate.promise;
    }),
    searchWorkspaceContent: vi.fn(() => {
      const gate = deferred<ContentPayload>();
      contentCalls.push(gate);
      return gate.promise;
    }),
  };
  return { client, nameCalls, contentCalls };
}

function rpcError(requestType: string): Error {
  const error = new Error(`Unknown request requestType=${requestType} code=unknown_schema`);
  error.name = "DaemonRpcError";
  Object.assign(error, { requestType });
  return error;
}

describe("mapSuggestionHits", () => {
  it("maps file entries to preview-ready hits and skips directories", () => {
    const hits = mapSuggestionHits(
      [
        { path: "app/build/release.apk", kind: "file" },
        { path: "assets", kind: "directory" },
        { path: "README.md", kind: "file" },
      ],
      CTX,
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      key: "srv-1:ws-1:app/build/release.apk",
      name: "release.apk",
      path: "app/build/release.apk",
      directory: "app/build",
      workspaceRoot: "F:/Gd/IdleGame",
      hostLabel: "工作站",
    });
    expect(hits[1]?.directory).toBe(".");
  });

  it("keeps the server fuzzy ranking (no re-sort)", () => {
    const hits = mapSuggestionHits(
      [
        { path: "zz/apk.txt", kind: "file" },
        { path: "apk.md", kind: "file" },
      ],
      CTX,
    );
    expect(hits.map((hit) => hit.path)).toEqual(["zz/apk.txt", "apk.md"]);
  });
});

describe("mapContentHits", () => {
  it("keys rows by path:line and dedupes repeats", () => {
    const hits = mapContentHits([
      { path: "src/main.ts", line: 7, preview: "const apk = 1" },
      { path: "src/main.ts", line: 7, preview: "const apk = 1" },
      { path: "src/main.ts", line: 9, preview: "use(apk)" },
    ]);
    expect(hits.map((hit) => hit.key)).toEqual(["src/main.ts:7", "src/main.ts:9"]);
    expect(hits[0]).toMatchObject({ name: "main.ts", line: 7 });
  });
});

describe("isContentSearchUnsupportedError (KI-6S capability gate)", () => {
  it("fires only for a DaemonRpcError on the content_search request type", () => {
    expect(isContentSearchUnsupportedError(rpcError("workspace.content_search.request"))).toBe(
      true,
    );
    expect(isContentSearchUnsupportedError(rpcError("directory_suggestions_request"))).toBe(false);
    const nameless = new Error("boom");
    nameless.name = "DaemonRpcError";
    expect(isContentSearchUnsupportedError(nameless)).toBe(false);
    expect(isContentSearchUnsupportedError(new Error("timeout"))).toBe(false);
    expect(isContentSearchUnsupportedError("workspace.content_search.request")).toBe(false);
  });
});

describe("useWorkspaceSearch two-tier pipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function runDebounce() {
    await act(async () => {
      vi.advanceTimersByTime(WORKSPACE_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });
  }

  function render() {
    const { client, nameCalls, contentCalls } = makeClient();
    const view = renderHook(
      ({ active, query }) =>
        useWorkspaceSearch({
          active,
          query,
          client,
          fallbackSource: sourceWith("notes/apk-guide.md", "tools/keystore.jks"),
          ctx: CTX,
        }),
      { initialProps: { active: true, query: "" } },
    );
    return { view, client, nameCalls, contentCalls };
  }

  it("Tier-1 hit commits and never fires the content RPC", async () => {
    const { view, nameCalls, contentCalls } = render();
    act(() => view.rerender({ active: true, query: "apk" }));
    await runDebounce();
    expect(nameCalls).toHaveLength(1);
    expect(nameCalls[0] && view.result.current.pending).toBe(true);
    await act(async () => {
      nameCalls[0]?.resolve({
        entries: [{ path: "build/release.apk", kind: "file" }],
        error: null,
      });
    });
    expect(view.result.current.nameHits.map((hit) => hit.path)).toEqual(["build/release.apk"]);
    expect(view.result.current).toMatchObject({ pending: false, fallback: false, contentHits: [] });
    expect(contentCalls).toHaveLength(0);
  });

  it("sends the card RPC shape: cwd=root, files-only fuzzy, limits 100/60", async () => {
    const { view, client, nameCalls, contentCalls } = render();
    act(() => view.rerender({ active: true, query: "  APK " }));
    await runDebounce();
    expect(client.getDirectorySuggestions).toHaveBeenCalledWith({
      cwd: "F:/Gd/IdleGame",
      query: "apk",
      includeFiles: true,
      includeDirectories: false,
      matchMode: "fuzzy",
      limit: NAME_SEARCH_LIMIT,
    });
    await act(async () => {
      nameCalls[0]?.resolve({ entries: [], error: null });
    });
    expect(contentCalls).toHaveLength(1);
    expect(client.searchWorkspaceContent).toHaveBeenCalledWith({
      cwd: "F:/Gd/IdleGame",
      query: "apk",
      limit: CONTENT_SEARCH_LIMIT,
    });
  });

  it("Tier-1 zero-hit auto-fires content search and commits matches + truncated", async () => {
    const { view, nameCalls, contentCalls } = render();
    act(() => view.rerender({ active: true, query: "idlecoin" }));
    await runDebounce();
    await act(async () => {
      nameCalls[0]?.resolve({ entries: [], error: null });
    });
    expect(view.result.current).toMatchObject({ contentPending: true, pending: true });
    await act(async () => {
      contentCalls[0]?.resolve({
        matches: [{ path: "src/coins.ts", line: 3, preview: "const idlecoin = 42" }],
        truncated: true,
      });
    });
    expect(view.result.current).toMatchObject({
      contentHits: [{ key: "src/coins.ts:3", line: 3 }],
      contentTruncated: true,
      contentPending: false,
      pending: false,
    });
  });

  it("Tier-1 RPC failure demotes to the browsed index with fallback=true", async () => {
    const { view, nameCalls } = render();
    act(() => view.rerender({ active: true, query: "apk" }));
    await runDebounce();
    await act(async () => {
      nameCalls[0]?.reject(new Error("connection reset"));
    });
    expect(view.result.current).toMatchObject({ fallback: true, pending: false });
    expect(view.result.current.nameHits.map((hit) => hit.path)).toEqual(["notes/apk-guide.md"]);
  });

  it("a payload-level error counts as an RPC failure too", async () => {
    const { view, nameCalls } = render();
    act(() => view.rerender({ active: true, query: "apk" }));
    await runDebounce();
    await act(async () => {
      nameCalls[0]?.resolve({ entries: [], error: "cwd not found" });
    });
    expect(view.result.current.fallback).toBe(true);
  });

  it("content rpc_error degrades silently and the gate stays shut for later queries", async () => {
    const { view, nameCalls, contentCalls, client } = render();
    act(() => view.rerender({ active: true, query: "idlecoin" }));
    await runDebounce();
    await act(async () => {
      nameCalls[0]?.resolve({ entries: [], error: null });
    });
    await act(async () => {
      contentCalls[0]?.reject(rpcError("workspace.content_search.request"));
    });
    expect(view.result.current).toMatchObject({
      contentHits: [],
      contentPending: false,
      pending: false,
    });
    // Next query: name layer still runs, content layer never asks again.
    act(() => view.rerender({ active: true, query: "goldmine" }));
    await runDebounce();
    await act(async () => {
      nameCalls[1]?.resolve({ entries: [], error: null });
    });
    expect(client.getDirectorySuggestions).toHaveBeenCalledTimes(2);
    expect(client.searchWorkspaceContent).toHaveBeenCalledTimes(1);
    expect(view.result.current.pending).toBe(false);
  });

  it("a superseded Tier-1 response never lands (requestSeq guard)", async () => {
    const { view, nameCalls } = render();
    act(() => view.rerender({ active: true, query: "old" }));
    await runDebounce();
    act(() => view.rerender({ active: true, query: "new" }));
    await runDebounce();
    expect(nameCalls).toHaveLength(2);
    await act(async () => {
      nameCalls[1]?.resolve({
        entries: [{ path: "new.txt", kind: "file" }],
        error: null,
      });
    });
    await act(async () => {
      nameCalls[0]?.resolve({
        entries: [{ path: "old.txt", kind: "file" }],
        error: null,
      });
    });
    expect(view.result.current.nameHits.map((hit) => hit.path)).toEqual(["new.txt"]);
  });

  it("leaving search clears the result and an in-flight response cannot land", async () => {
    const { view, nameCalls } = render();
    act(() => view.rerender({ active: true, query: "apk" }));
    await runDebounce();
    act(() => view.rerender({ active: false, query: "apk" }));
    await act(async () => {
      nameCalls[0]?.resolve({
        entries: [{ path: "build/release.apk", kind: "file" }],
        error: null,
      });
    });
    expect(view.result.current).toMatchObject({ nameHits: [], pending: false, fallback: false });
  });

  it("no client (offline / not connected) answers from the browsed index immediately", async () => {
    const view = renderHook(() =>
      useWorkspaceSearch({
        active: true,
        query: "keystore",
        client: null,
        fallbackSource: sourceWith("tools/keystore.jks"),
        ctx: CTX,
      }),
    );
    await runDebounce();
    expect(view.result.current).toMatchObject({ fallback: true, pending: false });
    expect(view.result.current.nameHits.map((hit) => hit.path)).toEqual(["tools/keystore.jks"]);
  });
});
