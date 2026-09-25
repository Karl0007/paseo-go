// C8 acceptance (关于卡数据组装): the about card's three facts must survive the
// build-time injection path — EXPO_PUBLIC_PASEO_GO_UPSTREAM is inlined by metro, so
// the guard is on the SHAPE (short sha), not a pinned value; version stays
// semver-ish; the license link is the upstream absolute URL (mixed licensing means
// the app must not summarise it locally).
import { describe, expect, it } from "vitest";
import { buildShellAboutInfo, SHELL_LICENSE_URL } from "@/shell/about";

describe("buildShellAboutInfo", () => {
  it("assembles a semver-ish version and a short-sha upstream ref", () => {
    const info = buildShellAboutInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.upstreamRef).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("links the license at the upstream repo, absolutely", () => {
    const info = buildShellAboutInfo();
    expect(info.licenseUrl).toBe(SHELL_LICENSE_URL);
    expect(info.licenseUrl.startsWith("https://github.com/getpaseo/paseo/")).toBe(true);
  });
});
