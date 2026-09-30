// paseo-go M4 (paseo-go/todo/M4-update-pointer-fork.md): the packaged desktop app's
// auto-update feed must resolve to OUR fork's Releases (user ruling 2026-09-29 —
// every client update ships through Karl0007/paseo-go). electron-builder bakes this
// publish block into app-update.yml at build time, so a silent drift back to
// getpaseo/paseo would route fork users to upstream builds. This is the config-parse
// level proof required by the card (no second test machine; the fork CI additionally
// overrides owner/repo from the repository context in .github/workflows/fork-release.yml).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const CONFIG_URL = new URL("../../electron-builder.yml", import.meta.url);

interface BuilderConfig {
  publish?: { provider?: string; owner?: string; repo?: string };
}

describe("electron-builder publish feed (paseo-go fork)", () => {
  const config = parse(readFileSync(CONFIG_URL, "utf8")) as BuilderConfig;

  it("publishes to the fork's GitHub Releases, not upstream", () => {
    expect(config.publish).toMatchObject({
      provider: "github",
      owner: "Karl0007",
      repo: "paseo-go",
    });
  });
});
