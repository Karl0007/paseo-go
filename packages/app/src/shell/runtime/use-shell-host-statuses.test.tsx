// @vitest-environment jsdom
// R1 regression contract for useShellHostStatuses:
// 1. behaviour — a store emit (version bump) must refresh the map even when the
//    serverIds array identity never changes (the exact C2 failure: pill stuck
//    at connecting while the store is online).
// 2. compiler — the shipped bundle is built with React Compiler
//    (app.config.js experiments.reactCompiler); the compiled output must keep
//    `version` inside the status recomputation condition. The upstream hook's
//    `void version;` trick fails this and is why the shell has its own hook.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useShellHostStatuses } from "./use-shell-host-statuses";

vi.mock("@/runtime/host-runtime", () => {
  const listeners = new Set<() => void>();
  const store = {
    version: 0,
    status: "connecting" as string,
    subscribeAll(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion() {
      return store.version;
    },
    getSnapshot(serverId: string) {
      return { serverId, connectionStatus: store.status };
    },
    emit() {
      store.version += 1;
      for (const listener of listeners) listener();
    },
  };
  return { getHostRuntimeStore: () => store };
});

const SERVER_ID = "srv_r1";
const IDS: readonly string[] = [SERVER_ID];

function fakeStore() {
  return getHostRuntimeStore() as unknown as { status: string; emit(): void; version: number };
}

describe("useShellHostStatuses", () => {
  beforeEach(() => {
    const store = fakeStore();
    store.status = "connecting";
    store.version = 0;
  });

  it("refreshes the map on store emits without serverIds changing", () => {
    const { result } = renderHook(() => useShellHostStatuses(IDS));
    expect(result.current.get(SERVER_ID)).toBe("connecting");

    act(() => {
      fakeStore().status = "online";
      fakeStore().emit();
    });

    expect(result.current.get(SERVER_ID)).toBe("online");
  });

  it("falls back to connecting for unknown server ids", () => {
    const { result } = renderHook(() => useShellHostStatuses(["srv_missing"]));
    expect(result.current.get("srv_missing")).toBe("connecting");
  });
});

describe("useShellHostStatuses under React Compiler", () => {
  it("compiled memo keeps version in the recomputation condition", () => {
    const require = createRequire(import.meta.url);
    const babel = require("@babel/core");
    const compiler = require("babel-plugin-react-compiler");
    const here = dirname(fileURLToPath(import.meta.url));
    const compiled = babel.transformFileSync(join(here, "use-shell-host-statuses.ts"), {
      configFile: false,
      babelrc: false,
      presets: [[require("@babel/preset-typescript"), { isTSX: false, allExtensions: true }]],
      plugins: [
        [
          compiler,
          {
            target: "19",
            panicThreshold: "NONE",
            environment: { enableResetCacheOnSourceFileChanges: true },
          },
        ],
      ],
    }).code as string;

    const fn = compiled.slice(compiled.indexOf("function useShellHostStatuses"));
    const memoCondition = fn.match(/if \((\$|\w+)\[\d+\][^)]*version[^)]*\)/);
    expect(memoCondition, "compiled statuses memo must depend on version:\n" + fn).not.toBeNull();
  });
});
