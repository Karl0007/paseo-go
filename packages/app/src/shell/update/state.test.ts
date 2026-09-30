// M4 slice 2: the shared check machine. Pins the 一次性 banner rule (same version
// once, newer version re-arms) and the launch-probe guards (one auto probe, manual
// force re-fetches, concurrent presses do not double-inflight).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldShowBanner, useShellUpdateStore } from "./state";

beforeEach(() => {
  useShellUpdateStore.setState({ phase: "idle", latest: null, url: null, checkedOnce: false });
});

describe("shouldShowBanner", () => {
  it("shows only on an unseen available version", () => {
    expect(shouldShowBanner({ phase: "available", latest: "0.10.2-go.6", seenVersion: null })).toBe(
      true,
    );
    expect(
      shouldShowBanner({ phase: "available", latest: "0.10.2-go.6", seenVersion: "0.10.2-go.5" }),
    ).toBe(true);
    expect(
      shouldShowBanner({ phase: "available", latest: "0.10.2-go.6", seenVersion: "0.10.2-go.6" }),
    ).toBe(false);
    expect(shouldShowBanner({ phase: "upToDate", latest: "0.10.2-go.6", seenVersion: null })).toBe(
      false,
    );
    expect(shouldShowBanner({ phase: "error", latest: null, seenVersion: null })).toBe(false);
    expect(shouldShowBanner({ phase: "available", latest: null, seenVersion: null })).toBe(false);
  });
});

describe("useShellUpdateStore.runCheck", () => {
  function stubFeed(tag: string) {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: `v${tag}`, html_url: `https://example.invalid/${tag}` }],
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    return fetchImpl;
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("startup probe runs once per JS context; manual force re-fetches", async () => {
    const fetchImpl = stubFeed("9.9.9-go.1"); // newer than any baked 0.10.x
    const first = await useShellUpdateStore.getState().runCheck();
    expect(first?.state).toBe("available");
    expect(useShellUpdateStore.getState().phase).toBe("available");

    expect(await useShellUpdateStore.getState().runCheck()).toBeNull(); // auto guard
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const forced = await useShellUpdateStore.getState().runCheck(true);
    expect(forced?.state).toBe("available");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a second call while one is in flight is a silent no-op", async () => {
    const fetchImpl = stubFeed("0.10.2-go.0");
    const inflight = useShellUpdateStore.getState().runCheck(true);
    expect(await useShellUpdateStore.getState().runCheck(true)).toBeNull();
    expect(useShellUpdateStore.getState().phase).toBe("checking");
    await inflight;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("upToDate result clears any stale available payload", async () => {
    stubFeed("0.10.2-go.0"); // equal to the dev fallback → not newer
    await useShellUpdateStore.getState().runCheck(true);
    const state = useShellUpdateStore.getState();
    expect(state.phase).toBe("upToDate");
    expect(shouldShowBanner({ phase: state.phase, latest: state.latest, seenVersion: null })).toBe(
      false,
    );
  });
});
