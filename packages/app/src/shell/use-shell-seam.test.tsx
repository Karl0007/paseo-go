// @vitest-environment jsdom
// F2 regression: in an env-on package the user turned shell mode OFF — the seam
// must hold the startup placeholder until settings rehydrate, then honour
// shellMode=false (official IA). Pre-fix, the first frame read the un-hydrated
// store (shellMode null → env default true), redirected into the shell, and the
// Redirect unmounted Index before the persisted value could ever re-branch.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => {
  const state = { shellMode: null as boolean | null };
  const finishListeners = new Set<() => void>();
  let hydrated = false;
  const store = ((selector: (s: typeof state) => unknown) =>
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selector(state)) as unknown as {
    (selector: (s: typeof state) => unknown): unknown;
    persist: {
      hasHydrated(): boolean;
      onFinishHydration(cb: () => void): () => void;
    };
  };
  store.persist = {
    hasHydrated: () => hydrated,
    onFinishHydration: (cb) => {
      finishListeners.add(cb);
      return () => finishListeners.delete(cb);
    },
  };
  return {
    store,
    setShellMode(value: boolean | null) {
      state.shellMode = value;
    },
    finishHydration() {
      hydrated = true;
      for (const cb of finishListeners) cb();
    },
    reset() {
      hydrated = false;
      state.shellMode = null;
      finishListeners.clear();
    },
  };
});

vi.mock("@/shell/stores/settings", () => ({ usePaseoGoSettingsStore: settings.store }));
vi.mock("@/shell/config", () => ({ SHELL_MODE_ENV_DEFAULT: true }));

import { useShellSeam } from "./use-shell-seam";

describe("useShellSeam", () => {
  beforeEach(() => settings.reset());
  afterEach(() => vi.useRealTimers());

  it("holds pending pre-hydration and honours the persisted off-switch after", () => {
    const { result } = renderHook(() => useShellSeam());
    // Un-hydrated: gate closed — the env default must not decide anything yet.
    expect(result.current.pending).toBe(true);

    act(() => {
      settings.setShellMode(false); // the persisted "shell off" lands
      settings.finishHydration();
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it("opens straight to the shell when hydration already settled", () => {
    settings.setShellMode(true);
    settings.finishHydration();
    const { result } = renderHook(() => useShellSeam());
    expect(result.current.pending).toBe(false);
    expect(result.current.active).toBe(true);
  });

  it("a hydration that never completes releases via the failsafe, not a brick", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useShellSeam());
    expect(result.current.pending).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.pending).toBe(false);
    // Degraded branch = the pre-F2 behaviour: env default decides.
    expect(result.current.active).toBe(true);
  });
});
