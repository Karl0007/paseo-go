// M4 slice 2: the三态 state machine. Every row here is a false-positive/false-
// negative the user can observe (banner nags / "已是最新" lies), including the
// downgrade guard (feed older than the bundle — never "available").
import { describe, expect, it, vi } from "vitest";
import { runUpdateCheck } from "./checker";

function feedBody(tag: string) {
  return [
    { tag_name: `v${tag}`, html_url: `https://github.com/Karl0007/paseo-go/releases/tag/v${tag}` },
  ];
}

function feedReturning(tag: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => feedBody(tag),
  })) as unknown as typeof fetch;
}

describe("runUpdateCheck", () => {
  it("available: newer go release (and keeps the release page url)", async () => {
    const result = await runUpdateCheck({
      currentVersion: "0.10.2-go.0",
      feedUrl: "https://feed.invalid/releases?per_page=1",
      fetchImpl: feedReturning("0.10.2-go.6"),
    });
    expect(result).toMatchObject({
      state: "available",
      current: "0.10.2-go.0",
      latest: "0.10.2-go.6",
      url: "https://github.com/Karl0007/paseo-go/releases/tag/v0.10.2-go.6",
    });
  });

  it("available across the multi-digit go boundary (go.10 > go.9)", async () => {
    const result = await runUpdateCheck({
      currentVersion: "0.10.2-go.9",
      fetchImpl: feedReturning("0.10.2-go.10"),
    });
    expect(result.state).toBe("available");
  });

  it("upToDate on equality and on downgrade (feed older than the bundle)", async () => {
    const same = await runUpdateCheck({
      currentVersion: "0.10.2-go.6",
      fetchImpl: feedReturning("0.10.2-go.6"),
    });
    expect(same).toMatchObject({ state: "upToDate", latest: "0.10.2-go.6" });
    const older = await runUpdateCheck({
      currentVersion: "0.11.0-go.1",
      fetchImpl: feedReturning("0.10.2-go.6"),
    });
    expect(older.state).toBe("upToDate");
  });

  it("error: empty feed is NOT reported as up to date", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    })) as unknown as typeof fetch;
    const result = await runUpdateCheck({ currentVersion: "0.10.2-go.0", fetchImpl });
    expect(result).toMatchObject({ state: "error", reason: "feed-empty" });
  });

  it("error: newest release off the go line (mirror hygiene guard)", async () => {
    const result = await runUpdateCheck({
      currentVersion: "0.10.2-go.0",
      fetchImpl: feedReturning("0.10.3"),
    });
    expect(result).toMatchObject({ state: "error", reason: "feed-not-go-line", latest: "0.10.3" });
  });

  it("error: transport failure maps to feed-failed, never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    const result = await runUpdateCheck({ currentVersion: "0.10.2-go.0", fetchImpl });
    expect(result).toMatchObject({ state: "error", reason: "feed-failed" });
  });

  it("error: an unparseable baked version never nags (config bug fails silent)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await runUpdateCheck({ currentVersion: "0.3.0", fetchImpl });
    expect(result).toMatchObject({ state: "error", reason: "current-unparseable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
