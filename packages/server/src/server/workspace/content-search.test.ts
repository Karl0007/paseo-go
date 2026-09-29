import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchWorkspaceContent } from "./content-search.js";

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(path.join(tmpdir(), "paseo-content-search-"));
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Buffer): void {
  const absolute = path.join(workspaceDir, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

describe("searchWorkspaceContent", () => {
  it("finds case-insensitive substring matches with relative paths and 1-based lines", async () => {
    write("src/app.ts", "const first = 1;\n// needle here\nexport {}\n");
    write("src/nested/deep.ts", "NEEDLE at the top\n");
    write("readme.md", "no match in this file\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "Needle" });

    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual([
      { path: "src/app.ts", line: 2, preview: "// needle here" },
      { path: "src/nested/deep.ts", line: 1, preview: "NEEDLE at the top" },
    ]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("reports every matching line of a file, not just the first", async () => {
    write("multi.txt", "needle one\nfiller\nneedle two\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches.map((match) => match.line)).toEqual([1, 3]);
    expect(result.truncated).toBe(false);
  });

  it("skips binary files detected by a NUL probe", async () => {
    write("blob.bin", Buffer.from([0x6e, 0x00, 0x65, 0x65, 0x64, 0x6c, 0x65]));
    write("text.txt", "needle\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches.map((match) => match.path)).toEqual(["text.txt"]);
  });

  it("skips files above the per-file size gate without marking the scan truncated", async () => {
    write("huge.txt", `${"x".repeat(1024 * 1024)}needle\n`);
    write("small.txt", "needle\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches.map((match) => match.path)).toEqual(["small.txt"]);
    expect(result.truncated).toBe(false);
  });

  it("truncates when the total scan byte budget is exhausted", async () => {
    write("a.txt", "needle and a lot of text to count\n".repeat(10));
    write("b.txt", "needle in the second file\n".repeat(10));

    const result = await searchWorkspaceContent({
      root: workspaceDir,
      query: "needle",
      maxScanBytes: 30,
    });

    expect(result.truncated).toBe(true);
    // The budget stopped the scan, so completeness can never be claimed.
    expect(result.matches.length).toBeLessThanOrEqual(2);
  });

  it("truncates when the deadline passes before the walk finishes", async () => {
    write("a.txt", "needle\n");
    write("b.txt", "needle\n");

    const result = await searchWorkspaceContent({
      root: workspaceDir,
      query: "needle",
      timeoutMs: 0,
    });

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("marks truncated and caps results at the requested limit", async () => {
    write("a.txt", "needle\n");
    write("b.txt", "needle\n");
    write("c.txt", "needle\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle", limit: 2 });

    expect(result.matches.map((match) => match.path)).toEqual(["a.txt", "b.txt"]);
    expect(result.truncated).toBe(true);
  });

  it("does not mark truncated when the match count exactly reaches the limit", async () => {
    write("a.txt", "needle\n");
    write("b.txt", "needle\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle", limit: 2 });

    expect(result.matches.map((match) => match.path)).toEqual(["a.txt", "b.txt"]);
    expect(result.truncated).toBe(false);
  });

  it("caps previews at 120 characters of trimmed line text", async () => {
    write("long.txt", `    ${"n".repeat(200)}needle${"y".repeat(200)}    \n`);

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].preview).toHaveLength(120);
    expect(result.matches[0].preview.startsWith("n")).toBe(true);
  });

  it("strips carriage returns from CRLF lines while keeping line numbers", async () => {
    write("crlf.txt", "first\r\nneedle line\r\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches).toEqual([{ path: "crlf.txt", line: 2, preview: "needle line" }]);
  });

  it("skips hidden files and non-allowlisted dot-directories but traverses allowlisted ones", async () => {
    write(".env", "needle secret\n");
    write(".cache/store/entry.txt", "needle cached\n");
    write(".github/workflows/ci.yml", "needle in workflow\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches.map((match) => match.path)).toEqual([".github/workflows/ci.yml"]);
  });

  it("skips dependency and build directories even without git", async () => {
    write("node_modules/pkg/index.js", "needle dep\n");
    write("dist/bundle.js", "needle bundle\n");
    write("src/main.js", "needle source\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches.map((match) => match.path)).toEqual(["src/main.js"]);
  });

  it("honors .gitignore rules in a git repository", async () => {
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    writeFileSync(path.join(workspaceDir, ".gitignore"), "generated/\nsecret.log\n");
    write("generated/data.txt", "needle generated\n");
    write("secret.log", "needle secret\n");
    write("src/kept.txt", "needle kept\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "needle" });

    expect(result.matches.map((match) => match.path)).toEqual(["src/kept.txt"]);
    expect(result.truncated).toBe(false);
  });

  it("returns no matches for an empty query without scanning", async () => {
    write("a.txt", "needle\n");

    const empty = await searchWorkspaceContent({ root: workspaceDir, query: "" });

    expect(empty.matches).toEqual([]);
    expect(empty.truncated).toBe(false);
  });

  it("treats a whitespace query as a literal substring", async () => {
    write("a.txt", "x   y\n");

    const result = await searchWorkspaceContent({ root: workspaceDir, query: "   " });

    expect(result.matches).toEqual([{ path: "a.txt", line: 1, preview: "x   y" }]);
  });

  it("rejects a root that is not a directory", async () => {
    await expect(
      searchWorkspaceContent({ root: path.join(workspaceDir, "missing"), query: "needle" }),
    ).rejects.toThrow(/Directory not found/);
  });
});
