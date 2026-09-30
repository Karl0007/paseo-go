// M4 slice 2: `0.10.x-go.N` parse/compare invariants. The checker's whole false-
// positive/false-negative surface lives here, including the multi-digit boundary
// (go.10 vs go.9 — a string compare would flip it) and the strictness of the
// release-line shape (upstream-style tags must NOT parse).
import { describe, expect, it } from "vitest";
import { compareGoVersions, parseGoVersion } from "./versions";

describe("parseGoVersion", () => {
  it("parses the fork release-line shape, tag `v` optional, whitespace tolerated", () => {
    expect(parseGoVersion("0.10.2-go.0")).toEqual({ major: 0, minor: 10, patch: 2, go: 0 });
    expect(parseGoVersion("v0.10.2-go.6")).toEqual({ major: 0, minor: 10, patch: 2, go: 6 });
    expect(parseGoVersion("  0.11.0-go.12  ")).toEqual({ major: 0, minor: 11, patch: 0, go: 12 });
  });

  it.each([
    "0.10.2", // upstream release, not our line
    "0.10.2-beta.3", // upstream beta line
    "0.10.2-go", // missing number
    "0.10-go.1", // missing patch
    "0.10.2-go.1-rc", // trailing junk
    "",
    "0.10.2-go.-1",
  ])("rejects %j (null = not a go release)", (raw) => {
    expect(parseGoVersion(raw)).toBeNull();
  });
  it("rejects null/undefined without throwing", () => {
    expect(parseGoVersion(null)).toBeNull();
    expect(parseGoVersion(undefined)).toBeNull();
  });
});

describe("compareGoVersions", () => {
  const v = (major: number, minor: number, patch: number, go: number) => ({
    major,
    minor,
    patch,
    go,
  });

  it("orders segmentally, numeric (go.10 > go.9)", () => {
    expect(compareGoVersions(v(0, 10, 2, 10), v(0, 10, 2, 9))).toBeGreaterThan(0);
    expect(compareGoVersions(v(0, 10, 2, 0), v(0, 10, 2, 0))).toBe(0);
    expect(compareGoVersions(v(0, 10, 1, 99), v(0, 10, 2, 0))).toBeLessThan(0);
    expect(compareGoVersions(v(0, 10, 9, 0), v(0, 11, 0, 0))).toBeLessThan(0);
    expect(compareGoVersions(v(1, 0, 0, 0), v(0, 99, 99, 99))).toBeGreaterThan(0);
  });
});
