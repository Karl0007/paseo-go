// M4 slice 2: feed transport + the test-hook resolution. The endpoint choice is a
// measured decision (prerelease releases are invisible to /releases/latest — the
// header in feed.ts records the probe); these tests pin the contract a mock feed
// must satisfy, which is exactly what the device-lane fake-latest run serves.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UPDATE_FEED_URL, fetchLatestRelease, resolveUpdateFeedUrl } from "./feed";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolveUpdateFeedUrl (test hook)", () => {
  it("defaults to the fork Releases LIST endpoint (prereleases included)", () => {
    expect(resolveUpdateFeedUrl()).toBe(
      "https://api.github.com/repos/Karl0007/paseo-go/releases?per_page=1",
    );
    expect(DEFAULT_UPDATE_FEED_URL).toContain("releases?per_page=1");
    // The decided-against endpoint must not sneak back in (404s on prerelease-only repos).
    expect(resolveUpdateFeedUrl()).not.toContain("releases/latest");
  });

  it("EXPO_PUBLIC_PASEO_GO_UPDATE_FEED overrides it (bundle-time mock lane)", () => {
    vi.stubEnv("EXPO_PUBLIC_PASEO_GO_UPDATE_FEED", " http://192.168.31.190:8099/fake.json ");
    expect(resolveUpdateFeedUrl()).toBe("http://192.168.31.190:8099/fake.json");
    vi.stubEnv("EXPO_PUBLIC_PASEO_GO_UPDATE_FEED", "   ");
    expect(resolveUpdateFeedUrl()).toBe(DEFAULT_UPDATE_FEED_URL);
  });
});

describe("fetchLatestRelease", () => {
  it("maps the newest list entry to {version,url}, stripping the tag v", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse([
        {
          tag_name: "v0.10.2-go.6",
          html_url: "https://github.com/Karl0007/paseo-go/releases/tag/v0.10.2-go.6",
        },
        { tag_name: "v0.10.2-go.5", html_url: "https://example.invalid/go.5" },
      ]),
    );
    const release = await fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(release).toEqual({
      version: "0.10.2-go.6",
      url: "https://github.com/Karl0007/paseo-go/releases/tag/v0.10.2-go.6",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(DEFAULT_UPDATE_FEED_URL);
  });

  it("empty feed answers null (up, nothing to point at)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    await expect(
      fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
  });

  it("non-2xx throws (rate-limited/offline surfaces as the error state)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "rate limited" }, false, 403));
    await expect(
      fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow("403");
  });

  it("malformed release shape throws instead of guessing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ tag_name: "v0.10.2-go.7" }]));
    await expect(
      fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow("shape");
  });

  it("aborts a hung probe at timeoutMs", async () => {
    const fetchImpl = (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(
      fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5 }),
    ).rejects.toThrow("aborted");
  });
});
