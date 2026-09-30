// RESEARCH-provider-dual-write ruling 2, manager half: the fork decision is a
// durable-fact question (`external` + the external writer still looks alive), so
// it is derived from the stored record on the resume path — which is exactly the
// path a send into a released session takes — and handed to the provider as the
// runtime-only `forkOnResume` intent.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import type { AgentClient, AgentResumeSessionOptions } from "./agent-sdk-types.js";
import { claudeProjectDirSync } from "./providers/claude/project-dir.js";

const AGENT_ID = "3f2a9c1e-6b4d-4e8f-9a11-72c5d0e4b8aa";

function createResumeCapturingClient(): {
  client: AgentClient;
  resumes: AgentResumeSessionOptions[];
} {
  const inner = createTestAgentClient("claude");
  const resumes: AgentResumeSessionOptions[] = [];
  const client = new Proxy(inner, {
    get(target, prop) {
      if (prop === "resumeSession") {
        return async (...args: Parameters<AgentClient["resumeSession"]>) => {
          resumes.push(args[3] ?? {});
          return target.resumeSession(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { client, resumes };
}

function releasedClaudeRecord(
  work: string,
  overrides: Partial<StoredAgentRecord>,
): StoredAgentRecord {
  return {
    id: AGENT_ID,
    provider: "claude",
    cwd: work,
    workspaceId: "ws-fork",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    config: { provider: "claude", cwd: work },
    persistence: { provider: "claude", sessionId: "sid-fork" },
    ownership: "external",
    externalLooksActive: true,
    ownershipBaselineBytes: 10,
    ...overrides,
  };
}

describe("AgentManager fork-on-send (claude dual-writer)", () => {
  it("derives forkOnResume from the record, and only from that fact", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "agent-fork-on-send-"));
    const configDir = path.join(work, "claude-config");
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    mkdirSync(claudeProjectDirSync(work, { configDir }), { recursive: true });

    const { client, resumes } = createResumeCapturingClient();
    const logger = createTestLogger();
    const storage = new AgentStorage(path.join(work, "agents"), logger);
    const manager = new AgentManager({
      clients: { claude: client },
      registry: storage,
      transcriptStatPollIntervalMs: 60 * 60 * 1000,
      logger,
    });

    try {
      await storage.initialize();
      const handle = { provider: "claude", sessionId: "sid-fork", metadata: { cwd: work } };

      // external + the external writer looks alive → derive a forked session.
      await storage.upsert(releasedClaudeRecord(work, {}));
      await manager.resumeAgentFromPersistence(handle, undefined, AGENT_ID);
      expect(resumes.at(-1)).toMatchObject({ purpose: "interactive", forkOnResume: true });
      await manager.closeAgent(AGENT_ID);

      // external but nobody is writing any more: the R4 warning is enough, the
      // transcript is continued in place.
      await storage.upsert(releasedClaudeRecord(work, { externalLooksActive: false }));
      await manager.resumeAgentFromPersistence(handle, undefined, AGENT_ID);
      expect(resumes.at(-1)?.forkOnResume).toBeUndefined();
      await manager.closeAgent(AGENT_ID);

      // paseo-owned / unclaimed records never fork.
      await storage.upsert(releasedClaudeRecord(work, { ownership: "none" }));
      await manager.resumeAgentFromPersistence(handle, undefined, AGENT_ID);
      expect(resumes.at(-1)?.forkOnResume).toBeUndefined();
      await manager.closeAgent(AGENT_ID);

      // An archived session is resumed to READ its transcript; forking would
      // rewrite the history the user opened it for.
      await storage.upsert(releasedClaudeRecord(work, { archivedAt: "2026-09-29T00:00:00.000Z" }));
      await manager.resumeAgentFromPersistence(handle, undefined, AGENT_ID);
      expect(resumes.at(-1)).toMatchObject({ purpose: "history" });
      expect(resumes.at(-1)?.forkOnResume).toBeUndefined();
      await manager.closeAgent(AGENT_ID).catch(() => undefined);
    } finally {
      manager.stopTranscriptWatch();
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      rmSync(work, { recursive: true, force: true });
    }
  });
});
