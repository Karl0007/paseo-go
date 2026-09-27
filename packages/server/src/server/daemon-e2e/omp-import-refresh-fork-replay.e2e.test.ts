import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pino from "pino";

import { OmpAgentClient } from "../agent/providers/omp/agent.js";
import { FakeOmp } from "../agent/providers/omp/test-utils/fake-omp.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface OmpJournalEntry {
  type: string;
  id: string;
  parentId: string | null;
  customType?: string;
  message?: { role: string; content: unknown };
  [key: string]: unknown;
}

function userEntry(id: string, parentId: string, text: string): OmpJournalEntry {
  return { type: "message", id, parentId, message: { role: "user", content: text } };
}

function assistantEntry(id: string, parentId: string, text: string): OmpJournalEntry {
  return {
    type: "message",
    id,
    parentId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function sessionExitEntry(id: string, parentId: string): OmpJournalEntry {
  return { type: "custom", customType: "session_exit", id, parentId };
}

function journalLines(entries: readonly OmpJournalEntry[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function timelineText(entries: ReadonlyArray<{ item: { type: string; text?: string } }>): string {
  return entries
    .filter(
      (entry): entry is { item: { type: "user_message" | "assistant_message"; text: string } } =>
        entry.item.type === "user_message" || entry.item.type === "assistant_message",
    )
    .map((entry) => entry.item.text)
    .join("\n");
}

// C35 regression: refreshing an imported omp session must replay turns that an
// external `omp -r` run appended as a fork, even when the file's last leaf is a
// lifecycle-only `session_exit` sibling written by the daemon-side process.
// The same refresh must not archive or drop the agent from the directory.
describe("daemon E2E - omp import refresh replays forked appends and keeps the agent listed", () => {
  let cwd: string;
  let sessionFile: string;
  let daemon: TestPaseoDaemon | undefined;
  let client: DaemonClient | undefined;

  const ompSessionId = randomUUID();

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "omp-refresh-fork-"));
    sessionFile = path.join(cwd, "ImportedFork.jsonl");
    writeFileSync(
      sessionFile,
      journalLines([
        { type: "session", id: ompSessionId, parentId: null, cwd, timestamp: Date.now() },
        userEntry("user-1", ompSessionId, "first hello"),
        assistantEntry("assistant-1", "user-1", "first reply"),
        sessionExitEntry("exit-1", "assistant-1"),
      ]),
      "utf8",
    );
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    client = undefined;
    await daemon?.close().catch(() => undefined);
    daemon = undefined;
    rmSync(cwd, { recursive: true, force: true });
  }, 60_000);

  test("refresh replays the forked probe turn and the agent stays in the directory", async () => {
    const logger = pino({ level: "silent" });
    const fakeOmp = new FakeOmp();
    daemon = await createTestPaseoDaemon({
      agentClients: {
        omp: new OmpAgentClient({ logger, runtime: fakeOmp }),
      },
      providerOverrides: { omp: { enabled: true } },
      logger,
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });

    const imported = await client.importAgent({ provider: "omp", sessionId: sessionFile, cwd });
    expect(imported.id).toBeTruthy();

    const before = await client.fetchAgentTimeline(imported.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    const beforeText = timelineText(before.entries);
    expect(beforeText).toContain("first hello");
    expect(beforeText).toContain("first reply");
    expect(beforeText).not.toContain("refresh probe");
    const epochBefore = before.epoch;

    // External `omp -r <file> -p probe` appended a turn onto the exit head,
    // then the daemon-side process disposed against the same parent, leaving a
    // lifecycle-only sibling as the last leaf in the file (C24 journal shape).
    appendFileSync(
      sessionFile,
      journalLines([
        userEntry("user-probe", "exit-1", "Reply with exactly: C35 refresh probe OK"),
        assistantEntry("assistant-probe", "user-probe", "C35 refresh probe OK"),
        sessionExitEntry("exit-probe", "assistant-probe"),
        sessionExitEntry("exit-daemon-sibling", "exit-1"),
      ]),
      "utf8",
    );

    await client.refreshAgent(imported.id);

    const after = await client.fetchAgentTimeline(imported.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    const afterText = timelineText(after.entries);
    expect(afterText).toContain("first hello");
    expect(afterText).toContain("Reply with exactly: C35 refresh probe OK");
    expect(afterText).toContain("C35 refresh probe OK");
    expect(after.entries.length).toBeGreaterThan(before.entries.length);
    expect(after.epoch).not.toBe(epochBefore);

    // Refresh alone must not archive the agent or drop it from the directory.
    const directory = await client.fetchAgents({ filter: { includeArchived: true } });
    const listed = directory.entries.find((entry) => entry.agent.id === imported.id);
    expect(listed).toBeDefined();
    expect(listed?.agent.archivedAt ?? null).toBeNull();
  }, 60_000);
});
