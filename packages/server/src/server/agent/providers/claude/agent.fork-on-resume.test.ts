// RESEARCH-provider-dual-write ruling 2 (claude): an `external` session whose
// external writer still looks alive must NOT be resumed in place — the next
// resume picks the deepest branch of the transcript DAG, so paseo's own branch
// would be dropped silently. The manager passes `forkOnResume` and the claude
// provider turns it into the SDK's `forkSession` (CLI `--fork-session`), which
// derives a new native session: both lines survive.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { streamSession } from "../test-utils/session-stream-adapter.js";
import type { AgentPersistenceHandle, AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeOptions } from "./query.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function buildQueryMock(events: unknown[]) {
  let index = 0;
  return {
    next: vi.fn(async () =>
      index >= events.length
        ? { done: true, value: undefined }
        : { done: false, value: events[index++] },
    ),
    interrupt: vi.fn(async () => undefined),
    return: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => []),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function initFrame(sessionId: string): unknown {
  return { type: "system", subtype: "init", session_id: sessionId, permissionMode: "default" };
}

const RESULT_FRAME = {
  type: "result",
  subtype: "success",
  usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
  total_cost_usd: 0,
};

/**
 * Resume (or create) a session behind a capturing query factory and return every
 * `Options` object the provider handed the SDK, one per query build.
 */
async function buildOptionsThroughSdk(input: {
  forkOnResume?: boolean;
  resumeSessionId?: string;
  reportedSessionIds: string[];
}): Promise<ClaudeOptions[]> {
  const cwd = mkdtempSync(path.join(tmpdir(), "claude-fork-resume-"));
  tempDirs.push(cwd);
  const configDir = path.join(cwd, "claude-config");
  mkdirSync(configDir, { recursive: true });
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;

  const captured: ClaudeOptions[] = [];
  let build = 0;
  const queryFactory = vi.fn((queryInput: { options: ClaudeOptions }) => {
    captured.push(queryInput.options);
    const sessionId =
      input.reportedSessionIds[Math.min(build, input.reportedSessionIds.length - 1)];
    build += 1;
    return buildQueryMock([initFrame(sessionId), RESULT_FRAME]);
  });
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: async () => "/test/claude/bin",
  });

  try {
    const session = input.resumeSessionId
      ? await client.resumeSession(
          {
            provider: "claude",
            sessionId: input.resumeSessionId,
            nativeHandle: input.resumeSessionId,
            metadata: { cwd },
          } satisfies AgentPersistenceHandle,
          undefined,
          undefined,
          { forkOnResume: input.forkOnResume },
        )
      : await client.createSession({ provider: "claude", cwd });
    await collectUntilTerminal(streamSession(session, "first"));
    // The fork's own id arrives on the init frame and rebinds the session, which
    // marks the query for restart — a second turn rebuilds the options.
    await collectUntilTerminal(streamSession(session, "second"));
    return captured;
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
  }
}

async function collectUntilTerminal(stream: AsyncGenerator<AgentStreamEvent>): Promise<void> {
  for await (const event of stream) {
    if (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    ) {
      return;
    }
  }
}

describe("claude fork-on-resume", () => {
  test("forkOnResume resumes the shared transcript with the SDK fork flag", async () => {
    const [first] = await buildOptionsThroughSdk({
      resumeSessionId: "origin-session",
      forkOnResume: true,
      reportedSessionIds: ["origin-session"],
    });

    expect(first?.resume).toBe("origin-session");
    expect(first?.forkSession).toBe(true);
  });

  test("a plain resume never sets the fork flag", async () => {
    const omitted = await buildOptionsThroughSdk({
      resumeSessionId: "origin-session",
      reportedSessionIds: ["origin-session"],
    });
    const declined = await buildOptionsThroughSdk({
      resumeSessionId: "origin-session",
      forkOnResume: false,
      reportedSessionIds: ["origin-session"],
    });

    expect(omitted[0]?.resume).toBe("origin-session");
    expect(omitted[0]?.forkSession).toBeUndefined();
    expect(declined[0]?.forkSession).toBeUndefined();
  });

  test("a session created here is never forked, only continued", async () => {
    const captured = await buildOptionsThroughSdk({
      reportedSessionIds: ["fresh-session"],
    });

    expect(captured[0]?.resume).toBeUndefined();
    expect(captured[0]?.forkSession).toBeUndefined();
  });

  test("the fork happens once: after the forked id is reported, restarts resume it in place", async () => {
    const captured = await buildOptionsThroughSdk({
      resumeSessionId: "origin-session",
      forkOnResume: true,
      // Turn 1 forks and the provider reports the derived id; turn 2 continues
      // THAT session. An ever-armed flag would fork again on every restart.
      reportedSessionIds: ["forked-session", "forked-session"],
    });

    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured[0]).toMatchObject({ resume: "origin-session", forkSession: true });
    expect(captured[1]?.resume).toBe("forked-session");
    expect(captured[1]?.forkSession).toBeUndefined();
  });
});
