import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { Logger } from "pino";

import {
  listOmpImportableSessions,
  readOmpImportSessionConfig,
  resolveOmpResumeAncestorPaths,
  resolveOmpResumeLeafChain,
} from "./session-descriptor.js";

async function writeSession(root: string, relativePath: string, lines: unknown[]): Promise<string> {
  const filePath = path.join(root, "sessions", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return filePath;
}

describe("OMP session descriptor", () => {
  test("cwd filtering continues past the global candidate overscan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-cwd-limit-"));
    const sessionsDir = path.join(root, "sessions");
    const requestedCwd = path.join(root, "requested");
    const otherCwd = path.join(root, "other");
    const requestedFile = await writeSession(root, "requested/requested.jsonl", [
      {
        type: "session",
        id: "requested-session",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: requestedCwd,
      },
    ]);
    await utimes(requestedFile, new Date("2026-06-01"), new Date("2026-06-01"));

    await Promise.all(
      Array.from({ length: 400 }, async (_, index) => {
        const file = await writeSession(root, `other/${index}.jsonl`, [
          {
            type: "session",
            id: `other-${index}`,
            timestamp: "2026-06-02T00:00:00.000Z",
            cwd: otherCwd,
          },
        ]);
        await utimes(file, new Date("2026-06-02"), new Date("2026-06-02"));
      }),
    );

    await expect(
      listOmpImportableSessions({ sessionDir: sessionsDir, cwd: requestedCwd, limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({ providerHandleId: requestedFile, cwd: requestedCwd }),
    ]);
  });

  test("reads title-first sessions and OMP combined model identifiers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-title-first-"));
    const cwd = path.join(root, "repo");
    const sessionFile = await writeSession(root, "project/session.jsonl", [
      {
        type: "title",
        id: "title-1",
        timestamp: "2026-06-09T00:00:00.000Z",
        title: "Deploy Paseo and verify",
      },
      {
        type: "session",
        version: 3,
        id: "session-title-first",
        timestamp: "2026-06-09T00:00:00.100Z",
        cwd,
      },
      {
        type: "model_change",
        id: "model-1",
        timestamp: "2026-06-09T00:00:00.200Z",
        model: "openai-codex/gpt-5.1",
      },
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-06-09T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "import me" }] },
      },
    ]);

    await expect(
      listOmpImportableSessions({ sessionDir: path.join(root, "sessions") }),
    ).resolves.toEqual([
      expect.objectContaining({
        providerHandleId: sessionFile,
        cwd,
        title: "Deploy Paseo and verify",
        firstPromptPreview: "import me",
      }),
    ]);
    await expect(readOmpImportSessionConfig(sessionFile)).resolves.toEqual({
      model: "openai-codex/gpt-5.1",
    });
  });

  test("keeps recent nested OMP subagent sessions importable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-nested-"));
    const cwd = path.join(root, "repo");
    const parent = await writeSession(root, "project/parent.jsonl", [
      { type: "session", id: "parent", timestamp: "2026-06-10T00:00:00.000Z", cwd },
      {
        type: "message",
        id: "parent-user",
        timestamp: "2026-06-10T00:00:01.000Z",
        message: { role: "user", content: "parent prompt" },
      },
    ]);
    const child = await writeSession(root, "project/parent/Explore.jsonl", [
      { type: "session", id: "child", timestamp: "2026-06-09T00:00:00.000Z", cwd },
      {
        type: "message",
        id: "child-user",
        timestamp: "2026-06-09T00:00:01.000Z",
        message: { role: "user", content: "child prompt" },
      },
    ]);
    await utimes(parent, new Date("2026-06-08"), new Date("2026-06-08"));
    await utimes(child, new Date("2026-06-09"), new Date("2026-06-09"));

    await expect(
      listOmpImportableSessions({ sessionDir: path.join(root, "sessions"), limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({
        providerHandleId: child,
        title: "Explore",
        firstPromptPreview: "child prompt",
      }),
    ]);
  });

  test("uses OMP's own default session directory", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-home-"));
    const cwd = path.join(home, "repo");
    const sessionFile = path.join(home, ".omp", "agent", "sessions", "project", "session.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "default-dir", timestamp: "2026-06-09", cwd })}\n`,
      "utf8",
    );

    await expect(listOmpImportableSessions({ homeDir: home, env: {} })).resolves.toEqual([
      expect.objectContaining({ providerHandleId: sessionFile, cwd }),
    ]);
  });

  test("labels nested subagent rows with the parent parsed in the same scan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-parent-chain-"));
    const cwd = path.join(root, "repo");
    const parent = await writeSession(root, "project/parent.jsonl", [
      {
        type: "session",
        id: "parent-session",
        parentId: null,
        timestamp: "2026-06-10T00:00:00.000Z",
        cwd,
      },
      { type: "title", id: "parent-title", title: "Ship the import screen" },
      {
        type: "message",
        id: "parent-user",
        timestamp: "2026-06-10T00:00:01.000Z",
        message: { role: "user", content: "parent prompt" },
      },
    ]);
    const child = await writeSession(root, "project/parent/Explore.jsonl", [
      // OMP builds that omit a cross-session parentId: the nested layout is the link.
      { type: "session", id: "child-session", timestamp: "2026-06-10T00:00:02.000Z", cwd },
      {
        type: "message",
        id: "child-user",
        timestamp: "2026-06-10T00:00:03.000Z",
        message: { role: "user", content: "child prompt" },
      },
    ]);
    const stale = new Date("2026-06-10T00:00:00.000Z");
    await utimes(parent, stale, stale);
    await utimes(child, stale, stale);

    const sessions = await listOmpImportableSessions({ sessionDir: path.join(root, "sessions") });

    expect(sessions.map((session) => session.providerHandleId)).toEqual([child, parent]);
    expect(sessions[0]).toMatchObject({
      parentHandleId: parent,
      parentTitle: "Ship the import screen",
    });
    // The parent is a root transcript: it has no parent chain to report.
    expect(sessions[1]).not.toHaveProperty("parentHandleId");
    expect(sessions[1]).not.toHaveProperty("parentTitle");
  });

  test("keeps the parent handle when the parent never entered the parsed window", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-parent-window-"));
    const cwd = path.join(root, "repo");
    const parent = await writeSession(root, "project/parent.jsonl", [
      { type: "session", id: "parent-session", timestamp: "2026-06-09T00:00:00.000Z", cwd },
      { type: "title", id: "parent-title", title: "Ship the import screen" },
    ]);
    const child = await writeSession(root, "project/parent/Explore.jsonl", [
      { type: "session", id: "child-session", timestamp: "2026-06-10T00:00:00.000Z", cwd },
    ]);
    await utimes(parent, new Date("2026-06-09"), new Date("2026-06-09"));
    await utimes(child, new Date("2026-06-10"), new Date("2026-06-10"));

    const sessions = await listOmpImportableSessions({
      sessionDir: path.join(root, "sessions"),
      limit: 1,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ providerHandleId: child, parentHandleId: parent });
    expect(sessions[0]).not.toHaveProperty("parentTitle");
  });

  test("resolves parentHandleId through the session header parentId", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-parent-id-"));
    const cwd = path.join(root, "repo");
    const spawner = await writeSession(root, "project/alpha/main.jsonl", [
      { type: "session", id: "root-session", timestamp: "2026-06-08T00:00:00.000Z", cwd },
      { type: "title", id: "root-title", title: "Root task" },
    ]);
    const linked = await writeSession(root, "project/beta/helper.jsonl", [
      {
        type: "session",
        id: "helper-session",
        parentId: "root-session",
        timestamp: "2026-06-09T00:00:00.000Z",
        cwd,
      },
    ]);
    const orphaned = await writeSession(root, "project/gamma/orphan.jsonl", [
      {
        type: "session",
        id: "orphan-session",
        parentId: "deleted-session",
        timestamp: "2026-06-10T00:00:00.000Z",
        cwd,
      },
    ]);

    const sessions = await listOmpImportableSessions({ sessionDir: path.join(root, "sessions") });
    const byHandle = new Map(sessions.map((session) => [session.providerHandleId, session]));

    // Cross-directory link: no nested layout here, only the header id.
    expect(byHandle.get(linked)).toMatchObject({
      parentHandleId: spawner,
      parentTitle: "Root task",
    });
    // Parent transcript is gone: the opaque id still groups siblings, no title invented.
    expect(byHandle.get(orphaned)).toMatchObject({ parentHandleId: "deleted-session" });
    expect(byHandle.get(orphaned)).not.toHaveProperty("parentTitle");
  });

  test("marks only recently touched transcripts as possibly active", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-looks-active-"));
    const cwd = path.join(root, "repo");
    const touched = await writeSession(root, "project/touched.jsonl", [
      { type: "session", id: "touched-session", timestamp: "2026-06-10T00:00:00.000Z", cwd },
    ]);
    const idle = await writeSession(root, "project/idle.jsonl", [
      { type: "session", id: "idle-session", timestamp: "2026-06-10T00:00:00.000Z", cwd },
    ]);
    const now = new Date();
    await utimes(touched, now, now);
    const idleAt = new Date(now.getTime() - 6 * 60 * 1000);
    await utimes(idle, idleAt, idleAt);

    const sessions = await listOmpImportableSessions({ sessionDir: path.join(root, "sessions") });
    const byHandle = new Map(sessions.map((session) => [session.providerHandleId, session]));

    expect(byHandle.get(touched)?.looksActive).toBe(true);
    expect(byHandle.get(idle)?.looksActive).toBe(false);
  });
});

// B5-IMPORT2（F17-4）：omp resume 写新文件、header `parentSession` 指旧文件；
// 服务端 existing 判定靠这条链认领祖先 transcript。
describe("resolveOmpResumeAncestorPaths", () => {
  test("walks the parentSession chain oldest-first and stops at the root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-chain-"));
    const cwd = path.join(root, "repo");
    const grand = await writeSession(root, "project/grand.jsonl", [
      { type: "title", id: "t", title: "Root", timestamp: "2026-06-01T00:00:00.000Z" },
      { type: "session", id: "grand-id", timestamp: "2026-06-01T00:00:00.000Z", cwd },
    ]);
    const parent = await writeSession(root, "project/parent.jsonl", [
      {
        type: "session",
        id: "parent-id",
        timestamp: "2026-06-02T00:00:00.000Z",
        cwd,
        parentSession: grand,
      },
    ]);
    const child = await writeSession(root, "project/child.jsonl", [
      {
        type: "session",
        id: "child-id",
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd,
        parentSession: parent,
      },
    ]);

    await expect(resolveOmpResumeAncestorPaths(child)).resolves.toEqual([parent, grand]);
    await expect(resolveOmpResumeAncestorPaths(grand)).resolves.toEqual([]);
  });

  test("broken links, cycles and non-jsonl parents end the walk safely", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-chain-guard-"));
    const missing = path.join(root, "sessions", "gone.jsonl");
    const start = await writeSession(root, "project/start.jsonl", [
      {
        type: "session",
        id: "start-id",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: root,
        parentSession: missing,
      },
    ]);
    await expect(resolveOmpResumeAncestorPaths(start)).resolves.toEqual([]);

    const loopA = path.join(root, "sessions", "project", "a.jsonl");
    const loopB = await writeSession(root, "project/b.jsonl", [
      {
        type: "session",
        id: "b",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: root,
        parentSession: loopA,
      },
    ]);
    await writeFile(
      loopA,
      `${JSON.stringify({ type: "session", id: "a", timestamp: "2026-06-01T00:00:00.000Z", cwd: root, parentSession: loopB })}\n`,
      "utf8",
    );
    const walked = await resolveOmpResumeAncestorPaths(loopA);
    expect(walked).toEqual([loopB]);

    const textParent = await writeSession(root, "project/text-parent.jsonl", [
      {
        type: "session",
        id: "tp",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: root,
        parentSession: "not-a-transcript",
      },
    ]);
    await expect(resolveOmpResumeAncestorPaths(textParent)).resolves.toEqual([]);
  });

  test("honors the depth cap on pathological chains", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-chain-cap-"));
    const deepest = await writeSession(root, "project/deepest.jsonl", [
      { type: "session", id: "deepest", timestamp: "2026-06-05T00:00:00.000Z", cwd: root },
    ]);
    let previous = deepest;
    for (let index = 0; index < 40; index += 1) {
      const next = await writeSession(root, `project/step-${index}.jsonl`, [
        {
          type: "session",
          id: `step-${index}`,
          timestamp: "2026-06-05T00:00:00.000Z",
          cwd: root,
          parentSession: previous,
        },
      ]);
      previous = next;
    }

    await expect(resolveOmpResumeAncestorPaths(previous, 8)).resolves.toHaveLength(8);
  });

  test("a parent path that rejects on read (directory named *.jsonl) ends the walk", async () => {
    // S2 (RevServer B5)：open() 对目录成功、handle.read() 才拒绝（EISDIR；网络盘
    // 同形 EIO）。行走读的是 transcript 内容里的裸路径，必须降级为「祖先未知」，
    // 不能把异常抛给整个导入列表请求。
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-chain-eisdir-"));
    const dirParent = path.join(root, "sessions", "project", "dir.jsonl");
    await mkdir(dirParent, { recursive: true });
    const start = await writeSession(root, "project/start.jsonl", [
      {
        type: "session",
        id: "start-id",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: root,
        parentSession: dirParent,
      },
    ]);
    await expect(resolveOmpResumeAncestorPaths(start)).resolves.toEqual([]);
  });

  test("logs when the depth cap truncates a live chain", async () => {
    // S4 (RevServer B5)：触顶截断此前不可见 —— 更深的祖先保持未认领。行为不变，
    // 触顶时补一条 warn。
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-chain-cap-log-"));
    const great = await writeSession(root, "project/great.jsonl", [
      { type: "session", id: "great", timestamp: "2026-06-01T00:00:00.000Z", cwd: root },
    ]);
    const grand = await writeSession(root, "project/grand.jsonl", [
      {
        type: "session",
        id: "grand",
        timestamp: "2026-06-02T00:00:00.000Z",
        cwd: root,
        parentSession: great,
      },
    ]);
    const parent = await writeSession(root, "project/parent.jsonl", [
      {
        type: "session",
        id: "parent",
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd: root,
        parentSession: grand,
      },
    ]);
    const warn = vi.fn();
    await expect(
      resolveOmpResumeAncestorPaths(parent, 1, { warn } as unknown as Logger),
    ).resolves.toEqual([grand]);
    expect(warn).toHaveBeenCalledTimes(1);

    // 链在帽内自然终止 → 静默。
    const quiet = vi.fn();
    await expect(
      resolveOmpResumeAncestorPaths(grand, 8, { warn: quiet } as unknown as Logger),
    ).resolves.toEqual([great]);
    expect(quiet).not.toHaveBeenCalled();
  });
});

// B8-WATCH（F28）：观察方向要顺同一条 parentSession 链**正向**走到叶子，否则
// watcher 挂在 paseo 留下的旧文件上，用户正在写的续写文件永远不可见。
describe("resolveOmpResumeLeafChain", () => {
  test("walks parentSession forward to the newest leaf", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-leaf-chain-"));
    const parent = await writeSession(root, "project/parent.jsonl", [
      { type: "session", id: "parent", timestamp: "2026-06-01T00:00:00.000Z", cwd: root },
    ]);
    const child = await writeSession(root, "project/child.jsonl", [
      {
        type: "session",
        id: "child",
        timestamp: "2026-06-02T00:00:00.000Z",
        cwd: root,
        parentSession: parent,
      },
    ]);
    const grand = await writeSession(root, "project/grand.jsonl", [
      {
        type: "session",
        id: "grand",
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd: root,
        parentSession: child,
      },
    ]);

    await expect(resolveOmpResumeLeafChain(parent)).resolves.toEqual([parent, child, grand]);
    await expect(resolveOmpResumeLeafChain(child)).resolves.toEqual([child, grand]);
    await expect(resolveOmpResumeLeafChain(grand)).resolves.toEqual([grand]);
  });

  test("stays on the start file when nothing resumes from it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-leaf-alone-"));
    const start = await writeSession(root, "project/start.jsonl", [
      { type: "session", id: "start", timestamp: "2026-06-01T00:00:00.000Z", cwd: root },
    ]);
    // 同目录兄弟会话 + 指向别的文件的续写：都不是 start 的孩子。
    await writeSession(root, "project/sibling.jsonl", [
      { type: "session", id: "sibling", timestamp: "2026-06-02T00:00:00.000Z", cwd: root },
    ]);
    await writeSession(root, "project/other-child.jsonl", [
      {
        type: "session",
        id: "other-child",
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd: root,
        parentSession: path.join(root, "sessions", "project", "sibling.jsonl"),
      },
    ]);

    await expect(resolveOmpResumeLeafChain(start)).resolves.toEqual([start]);
  });

  test("follows the most recently written resume when two share a parent", async () => {
    // 同一个父文件被 resume 两次：正在写的是最新那个，观察必须跟它。
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-leaf-branch-"));
    const parent = await writeSession(root, "project/parent.jsonl", [
      { type: "session", id: "parent", timestamp: "2026-06-01T00:00:00.000Z", cwd: root },
    ]);
    const older = await writeSession(root, "project/older.jsonl", [
      {
        type: "session",
        id: "older",
        timestamp: "2026-06-02T00:00:00.000Z",
        cwd: root,
        parentSession: parent,
      },
    ]);
    const newer = await writeSession(root, "project/newer.jsonl", [
      {
        type: "session",
        id: "newer",
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd: root,
        parentSession: parent,
      },
    ]);
    await utimes(older, new Date("2026-06-02"), new Date("2026-06-02"));
    await utimes(newer, new Date("2026-06-03"), new Date("2026-06-03"));

    await expect(resolveOmpResumeLeafChain(parent)).resolves.toEqual([parent, newer]);
  });

  test("a forward cycle ends the walk instead of looping", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-leaf-cycle-"));
    const a = await writeSession(root, "project/a.jsonl", [
      {
        type: "session",
        id: "a",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: root,
        parentSession: path.join(root, "sessions", "project", "b.jsonl"),
      },
    ]);
    const b = await writeSession(root, "project/b.jsonl", [
      {
        type: "session",
        id: "b",
        timestamp: "2026-06-02T00:00:00.000Z",
        cwd: root,
        parentSession: a,
      },
    ]);

    await expect(resolveOmpResumeLeafChain(a)).resolves.toEqual([a, b]);
  });

  test("skips transcripts older than the parent in a busy directory", async () => {
    // 大目录只 stat 不读头：比父文件更早的不可能是它的孩子。父文件之后新写的
    // 孩子必须仍然找到。
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-leaf-busy-"));
    const parent = await writeSession(root, "project/parent.jsonl", [
      { type: "session", id: "parent", timestamp: "2026-06-05T00:00:00.000Z", cwd: root },
    ]);
    await Promise.all(
      Array.from({ length: 70 }, async (_, index) => {
        const stale = await writeSession(root, `project/stale-${index}.jsonl`, [
          {
            type: "session",
            id: `stale-${index}`,
            timestamp: "2026-06-01T00:00:00.000Z",
            cwd: root,
          },
        ]);
        await utimes(stale, new Date("2026-06-01"), new Date("2026-06-01"));
      }),
    );
    await utimes(parent, new Date("2026-06-05"), new Date("2026-06-05"));
    const child = await writeSession(root, "project/child.jsonl", [
      {
        type: "session",
        id: "child",
        timestamp: "2026-06-06T00:00:00.000Z",
        cwd: root,
        parentSession: parent,
      },
    ]);
    await utimes(child, new Date("2026-06-06"), new Date("2026-06-06"));

    await expect(resolveOmpResumeLeafChain(parent)).resolves.toEqual([parent, child]);
  });

  test("honors the leaf-walk depth cap and says so", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-leaf-cap-"));
    let previous = await writeSession(root, "project/f0.jsonl", [
      { type: "session", id: "f0", timestamp: "2026-06-01T00:00:00.000Z", cwd: root },
    ]);
    const chain = [previous];
    for (let index = 1; index <= 4; index += 1) {
      previous = await writeSession(root, `project/f${index}.jsonl`, [
        {
          type: "session",
          id: `f${index}`,
          timestamp: `2026-06-0${index + 1}T00:00:00.000Z`,
          cwd: root,
          parentSession: previous,
        },
      ]);
      chain.push(previous);
    }

    const warn = vi.fn();
    await expect(
      resolveOmpResumeLeafChain(chain[0], { maxDepth: 2, logger: { warn } as unknown as Logger }),
    ).resolves.toEqual([chain[0], chain[1], chain[2]]);
    expect(warn).toHaveBeenCalledTimes(1);

    const quiet = vi.fn();
    await expect(
      resolveOmpResumeLeafChain(chain[0], {
        maxDepth: 8,
        logger: { warn: quiet } as unknown as Logger,
      }),
    ).resolves.toEqual(chain);
    expect(quiet).not.toHaveBeenCalled();
  });
});
