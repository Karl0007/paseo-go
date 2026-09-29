// @vitest-environment jsdom
// KI-15 gate-input contract for useAnyHostEverLoadedAgentDirectory:
// 1. behaviour — a store emit (version bump) must flip the gate input even when the
//    serverIds array identity never changes. This is the skeleton's release moment:
//    the first host completes its directory wave while a sibling sits connecting.
//    If the read were pinned (the R1 failure mode), the fix would not fire on device
//    and only the 10s timeout would save the screen.
// 2. compiler — the shipped bundle is built with React Compiler; the compiled output
//    must keep `version` inside the recomputation condition (statuses-hook idiom).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useAnyHostEverLoadedAgentDirectory } from "./use-any-host-ever-loaded";

vi.mock("@/runtime/host-runtime", () => {
  const listeners = new Set<() => void>();
  const store = {
    version: 0,
    everLoaded: {} as Record<string, boolean>,
    subscribeAll(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion() {
      return store.version;
    },
    getSnapshot(serverId: string) {
      return { serverId, hasEverLoadedAgentDirectory: store.everLoaded[serverId] === true };
    },
    emit() {
      store.version += 1;
      for (const listener of listeners) listener();
    },
  };
  return { getHostRuntimeStore: () => store };
});

const READY_ID = "srv_ready";
const STUCK_ID = "srv_stuck";
// Identity-stable across emits — the exact shape the KI-15 body passes (memoised hostIds).
const IDS: readonly string[] = [READY_ID, STUCK_ID];

function fakeStore() {
  return getHostRuntimeStore() as unknown as {
    version: number;
    everLoaded: Record<string, boolean>;
    emit(): void;
  };
}

describe("useAnyHostEverLoadedAgentDirectory", () => {
  beforeEach(() => {
    const store = fakeStore();
    store.version = 0;
    store.everLoaded = {};
  });

  it("masks while no host has completed its first directory wave", () => {
    const { result } = renderHook(() => useAnyHostEverLoadedAgentDirectory(IDS));
    expect(result.current).toBe(false);
  });

  it("releases on the store emit where a host lands, ids identity unchanged", () => {
    const { result } = renderHook(() => useAnyHostEverLoadedAgentDirectory(IDS));
    expect(result.current).toBe(false);

    // 真机 KI-15 场景：在线主机目录波完成（connecting 兄弟恒 false）。
    act(() => {
      fakeStore().everLoaded[READY_ID] = true;
      fakeStore().emit();
    });

    expect(result.current).toBe(true);
  });

  it("stays false for unknown server ids", () => {
    const { result } = renderHook(() => useAnyHostEverLoadedAgentDirectory(["srv_missing"]));
    expect(result.current).toBe(false);
  });
});

describe("useAnyHostEverLoadedAgentDirectory under React Compiler", () => {
  it("compiled memo keeps version in the recomputation condition", () => {
    const require = createRequire(import.meta.url);
    const babel = require("@babel/core");
    const compiler = require("babel-plugin-react-compiler");
    const here = dirname(fileURLToPath(import.meta.url));
    const compiled = babel.transformFileSync(join(here, "use-any-host-ever-loaded.ts"), {
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

    const fn = compiled.slice(compiled.indexOf("function useAnyHostEverLoadedAgentDirectory"));
    const memoCondition = fn.match(/if \((\$|\w+)\[\d+\][^)]*version[^)]*\)/);
    expect(memoCondition, "compiled gate-input memo must depend on version:\n" + fn).not.toBeNull();
  });
});
