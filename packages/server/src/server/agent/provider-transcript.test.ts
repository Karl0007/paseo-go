import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LOOKS_ACTIVE_MTIME_WINDOW_MS,
  findCodexRolloutFile,
  mapProviderTranscriptLines,
  resolveClaudeTranscriptPath,
  resolveProviderTranscriptPath,
  statTranscriptBytes,
} from "./provider-transcript.js";
import { claudeProjectDirSync } from "./providers/claude/project-dir.js";
import {
  claudeRegistryLooksActive,
  probeExternalTranscriptActivity,
  transcriptHandleIsHeld,
  transcriptLooksFresh,
} from "./transcript-activity-probe.js";

// B4-OWNERSHIP (batch-4 F8): the provider transcript funnel — where each provider's
// transcript lives, how its rows map, and which liveness signal the provider
// actually exposes. Layouts are the ones measured in RESEARCH-provider-dual-write.md.

let work = "";

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "provider-transcript-"));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function ompLine(role: string, text: string, id: string): string {
  return `${JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-30T00:00:00.000Z",
    message: { role, content: [{ type: "text", text }] },
  })}\n`;
}

describe("resolveProviderTranscriptPath", () => {
  it("reads the omp / pi transcript straight off the native handle", async () => {
    const file = join(work, "2026-09-30T00-00-00-000Z_uuid.jsonl");
    for (const provider of ["omp", "pi"] as const) {
      await expect(
        resolveProviderTranscriptPath({
          provider,
          cwd: work,
          persistence: { provider, sessionId: "uuid", nativeHandle: file },
        }),
      ).resolves.toBe(file);
    }
    // A handle that isn't a transcript file is no knowledge at all.
    await expect(
      resolveProviderTranscriptPath({
        provider: "omp",
        cwd: work,
        persistence: { provider: "omp", sessionId: "uuid", nativeHandle: "thread-1" },
      }),
    ).resolves.toBeNull();
    await expect(
      resolveProviderTranscriptPath({ provider: "omp", cwd: work, persistence: null }),
    ).resolves.toBeNull();
  });

  it("computes the claude path with the SDK project encoding", async () => {
    const configDir = join(work, "claude-config");
    const sessionId = "5fd02cb1-80f0-45dc-9c7a-e2b2d9440a20";
    const projectDir = claudeProjectDirSync(work, { configDir });
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, `${sessionId}.jsonl`);
    writeFileSync(file, ompLine("user", "hi", "1"));

    await expect(
      resolveProviderTranscriptPath({
        provider: "claude",
        cwd: work,
        persistence: { provider: "claude", sessionId },
        env: { CLAUDE_CONFIG_DIR: configDir },
      }),
    ).resolves.toBe(file);
  });

  it("falls back to the canonical claude path when the file is not created yet", () => {
    const configDir = join(work, "claude-config-missing");
    const expected = join(claudeProjectDirSync(work, { configDir }), "sid.jsonl");
    expect(resolveClaudeTranscriptPath({ cwd: work, sessionId: "sid", configDir })).toBe(expected);
    expect(resolveClaudeTranscriptPath({ cwd: work, sessionId: "", configDir })).toBeNull();
  });

  it("finds the codex rollout by thread id under the dated session tree", async () => {
    const codexHome = join(work, "codex-home");
    const older = join(codexHome, "sessions", "2026", "09", "01");
    const newer = join(codexHome, "sessions", "2026", "09", "30");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    const threadId = "01a0f299-9662-71f1-ae65-cd8b0382ab3a";
    const hit = join(newer, `rollout-2026-09-30T21-55-51-${threadId}.jsonl`);
    writeFileSync(join(older, `rollout-2026-09-01T10-00-00-${threadId}.jsonl`), "");
    writeFileSync(hit, "");
    writeFileSync(join(newer, "rollout-2026-09-30T21-55-52-unrelated.jsonl"), "");

    await expect(
      resolveProviderTranscriptPath({
        provider: "codex",
        cwd: work,
        persistence: { provider: "codex", sessionId: threadId },
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toBe(hit);
    await expect(
      findCodexRolloutFile({ codexHome, threadId: "00000000-0000-0000-0000-000000000000" }),
    ).resolves.toBeNull();
  });

  it("bounds the codex rollout walk by total directories walked, not the year list (R4-10)", async () => {
    const codexHome = join(work, "codex-home-deep");
    const threadId = "01a0f299-9662-71f1-ae65-cd8b0382dee0";
    // One year, one month, 70 day dirs. `years.slice(0, 64)` never cut
    // anything (real trees hold a handful of years), so the "bounded" walk
    // re-opened the whole tree on every resolve. The budget now counts EVERY
    // directory the walk opens, and a hit past it is genuinely not reached.
    for (let day = 1; day <= 70; day += 1) {
      mkdirSync(join(codexHome, "sessions", "2026", "10", String(day).padStart(2, "0")), {
        recursive: true,
      });
    }
    writeFileSync(
      join(
        codexHome,
        "sessions",
        "2026",
        "10",
        "01",
        `rollout-2026-10-01T00-00-00-${threadId}.jsonl`,
      ),
      "",
    );
    // Newest-first (lexicographic): day 70 … day 01 — the hit sits past the
    // 64-directory budget.
    await expect(findCodexRolloutFile({ codexHome, threadId })).resolves.toBeNull();

    // A hit inside the budget is still found.
    const nearId = "01a0f299-9662-71f1-ae65-cd8b0382near";
    writeFileSync(
      join(
        codexHome,
        "sessions",
        "2026",
        "10",
        "69",
        `rollout-2026-10-69T00-00-00-${nearId}.jsonl`,
      ),
      "",
    );
    await expect(findCodexRolloutFile({ codexHome, threadId: nearId })).resolves.toContain(nearId);
  });

  it("refuses handle identities that could escape the provider directory (R4-31)", async () => {
    // Handle fields reach this funnel from the import RPC verbatim; ids joined
    // into provider paths must be single, traversal-free segments, and omp/pi
    // native handles must be clean absolute file paths before anything tails
    // or `open`s them.
    const configDir = join(work, "claude-config-gate");
    expect(
      resolveClaudeTranscriptPath({ cwd: work, sessionId: "../escape", configDir }),
    ).toBeNull();
    expect(resolveClaudeTranscriptPath({ cwd: work, sessionId: "a/b", configDir })).toBeNull();
    await expect(findCodexRolloutFile({ codexHome: work, threadId: "a/b" })).resolves.toBeNull();

    // `path.join` would normalize these away; the handle is a raw client string.
    for (const nativeHandle of ["sessions/relative.jsonl", `${work}/nested/../s.jsonl`]) {
      await expect(
        resolveProviderTranscriptPath({
          provider: "omp",
          cwd: work,
          persistence: { provider: "omp", sessionId: "s", nativeHandle },
        }),
      ).resolves.toBeNull();
    }
    await expect(
      resolveProviderTranscriptPath({
        provider: "omp",
        cwd: work,
        persistence: { provider: "omp", sessionId: "s", nativeHandle: join(work, "s.jsonl") },
      }),
    ).resolves.toBe(join(work, "s.jsonl"));
  });

  it("has no transcript for opencode: a shared DB is not a per-session transcript", async () => {
    await expect(
      resolveProviderTranscriptPath({
        provider: "opencode",
        cwd: work,
        persistence: { provider: "opencode", sessionId: "ses_1", nativeHandle: "ses_1" },
      }),
    ).resolves.toBeNull();
    await expect(
      resolveProviderTranscriptPath({
        provider: "some-plugin",
        cwd: work,
        persistence: { provider: "some-plugin", sessionId: "x", nativeHandle: `${work}/x.jsonl` },
      }),
    ).resolves.toBeNull();
  });
});

describe("mapProviderTranscriptLines", () => {
  it("maps omp / pi message rows and skips control, tool, and unknown rows", () => {
    const chunk = [
      JSON.stringify({ type: "session", id: "s1" }),
      ompLine("user", "do the thing", "u1"),
      JSON.stringify({
        type: "message",
        id: "t1",
        message: { role: "toolResult", content: [{ type: "text", text: "output" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", text: "hmm" },
            { type: "text", text: "done" },
            { type: "toolCall", name: "shell" },
          ],
        },
      }),
      JSON.stringify({ type: "title_change", id: "x", title: "renamed" }),
      "{ not json",
      "",
    ].join("\n");

    expect(mapProviderTranscriptLines("omp", chunk)).toEqual([
      { type: "user_message", text: "do the thing", messageId: "u1" },
      { type: "assistant_message", text: "done", messageId: "a1" },
    ]);
    expect(mapProviderTranscriptLines("pi", chunk)).toHaveLength(2);
  });

  it("maps claude rows, dropping sidechains and volatile meta rows", () => {
    const chunk = [
      JSON.stringify({ type: "last-prompt", lastPrompt: "x" }),
      JSON.stringify({
        type: "user",
        uuid: "u1",
        isSidechain: false,
        message: { role: "user", content: "plain string prompt" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "side",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "subagent" }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "tool",
        message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
      }),
    ].join("\n");

    expect(mapProviderTranscriptLines("claude", chunk)).toEqual([
      { type: "user_message", text: "plain string prompt", messageId: "u1" },
      { type: "assistant_message", text: "first\nsecond", messageId: "a1" },
    ]);
  });

  it("maps codex response_item messages only, never the event_msg mirrors", () => {
    const chunk = [
      JSON.stringify({ type: "session_meta", payload: { id: "t" } }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "ZEBRA" }],
        },
      }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "ZEBRA" } }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "read back" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "sys" }],
        },
      }),
      JSON.stringify({ type: "turn_context", payload: { cwd: "/tmp" } }),
    ].join("\n");

    expect(mapProviderTranscriptLines("codex", chunk)).toEqual([
      { type: "user_message", text: "ZEBRA" },
      { type: "assistant_message", text: "read back" },
    ]);
  });

  it("yields nothing for a provider with no known row format", () => {
    expect(mapProviderTranscriptLines("opencode", ompLine("user", "hi", "1"))).toEqual([]);
  });
});

describe("external activity probes", () => {
  it("reads the claude live-session registry by sessionId + pid", async () => {
    const configDir = join(work, "claude-live");
    mkdirSync(join(configDir, "sessions"), { recursive: true });
    writeFileSync(
      join(configDir, "sessions", `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId: "target", cwd: work }),
    );
    writeFileSync(
      join(configDir, "sessions", "999999.json"),
      JSON.stringify({ pid: 999999, sessionId: "stale", cwd: work }),
    );
    writeFileSync(join(configDir, "sessions", "garbage.json"), "{ nope");

    await expect(claudeRegistryLooksActive({ sessionId: "target", configDir })).resolves.toBe(true);
    // A registry row for a dead pid is not evidence.
    await expect(claudeRegistryLooksActive({ sessionId: "stale", configDir })).resolves.toBe(false);
    await expect(claudeRegistryLooksActive({ sessionId: "absent", configDir })).resolves.toBe(
      false,
    );
    await expect(
      claudeRegistryLooksActive({ sessionId: "target", configDir: join(work, "nowhere") }),
    ).resolves.toBe(false);
  });

  it("routes each provider to the signal its client actually exposes", async () => {
    const file = join(work, "fresh-pi.jsonl");
    writeFileSync(file, ompLine("user", "hi", "1"));
    const old = join(work, "stale-pi.jsonl");
    writeFileSync(old, ompLine("user", "hi", "1"));
    const past = new Date(Date.now() - LOOKS_ACTIVE_MTIME_WINDOW_MS * 3);
    utimesSync(old, past, past);

    await expect(
      probeExternalTranscriptActivity({ provider: "pi", transcriptPath: file, sessionId: "s" }),
    ).resolves.toBe(true);
    await expect(
      probeExternalTranscriptActivity({ provider: "pi", transcriptPath: old, sessionId: "s" }),
    ).resolves.toBe(false);
    // opencode has no per-session artifact to probe (research: the warning is noise).
    await expect(
      probeExternalTranscriptActivity({
        provider: "opencode",
        transcriptPath: null,
        sessionId: "s",
      }),
    ).resolves.toBe(false);
    // No path at all is never "active".
    await expect(
      probeExternalTranscriptActivity({ provider: "omp", transcriptPath: null, sessionId: "s" }),
    ).resolves.toBe(false);
  });

  it("answers the exclusive-open probe only where the platform can", async () => {
    const free = join(work, "unheld.jsonl");
    writeFileSync(free, "");
    // Windows asks the question for real (an unheld file opens read-write);
    // POSIX opens never conflict, so the probe must report "unknown", not "no writer".
    await expect(transcriptHandleIsHeld(free)).resolves.toBe(
      process.platform === "win32" ? false : null,
    );
    await expect(transcriptHandleIsHeld(null)).resolves.toBeNull();
  });

  it("treats a missing transcript as neither fresh nor held", async () => {
    const missing = join(work, "gone.jsonl");
    await expect(transcriptLooksFresh(missing, Date.now())).resolves.toBe(false);
    await expect(statTranscriptBytes(missing)).resolves.toBeNull();
  });

  it("rejects invalid and stale claude registry rows (R4-21/26)", async () => {
    const configDir = join(work, "claude-registry-gates");
    const registryDir = join(configDir, "sessions");
    mkdirSync(registryDir, { recursive: true });
    const writeRow = (name: string, body: unknown, ageMs = 0) => {
      const file = join(registryDir, name);
      writeFileSync(file, JSON.stringify(body));
      if (ageMs > 0) {
        const past = new Date(Date.now() - ageMs);
        utimesSync(file, past, past);
      }
    };
    // The registry is external-CLI input: pid 0 / negative pids address
    // process GROUPS on POSIX (signal-0 succeeds against ourselves), and a
    // crash leftover whose pid was recycled by an unrelated process would
    // otherwise read as a live external session forever.
    writeRow("zero.json", { pid: 0, sessionId: "zero" });
    writeRow("negative.json", { pid: -12345, sessionId: "negative" });
    writeRow("fractional.json", { pid: 1.5, sessionId: "fractional" });
    writeRow(
      "recycled.json",
      { pid: process.pid, sessionId: "recycled" },
      LOOKS_ACTIVE_MTIME_WINDOW_MS * 3,
    );

    await expect(claudeRegistryLooksActive({ sessionId: "zero", configDir })).resolves.toBe(false);
    await expect(claudeRegistryLooksActive({ sessionId: "negative", configDir })).resolves.toBe(
      false,
    );
    await expect(claudeRegistryLooksActive({ sessionId: "fractional", configDir })).resolves.toBe(
      false,
    );
    // A live pid is not enough when the row itself is an old leftover.
    await expect(claudeRegistryLooksActive({ sessionId: "recycled", configDir })).resolves.toBe(
      false,
    );
    // The same live pid with a fresh row still reports active (the gate must
    // not blind the probe for the normal case).
    writeRow("live.json", { pid: process.pid, sessionId: "recycled" });
    await expect(claudeRegistryLooksActive({ sessionId: "recycled", configDir })).resolves.toBe(
      true,
    );
  });

  it.skipIf(process.platform !== "win32")(
    "reads permission errors as unknown, never as a sharing violation (R4-20)",
    async () => {
      // Windows-only surface (POSIX short-circuits to null): a read-only
      // transcript answers `open("r+")` with EPERM/EACCES while NO writer
      // holds it. Reading that as "held" manufactured a permanent false
      // `externalLooksActive`; it must fall through to the freshness signal.
      const readOnly = join(work, "read-only-transcript.jsonl");
      writeFileSync(readOnly, ompLine("user", "hi", "1"));
      chmodSync(readOnly, 0o444);
      try {
        await expect(transcriptHandleIsHeld(readOnly)).resolves.toBeNull();
      } finally {
        chmodSync(readOnly, 0o644);
        rmSync(readOnly, { force: true });
      }
    },
  );
});
