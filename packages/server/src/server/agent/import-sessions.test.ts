import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentManager,
  ManagedAgent,
  ManagedImportableProviderSession,
} from "./agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import { INITIAL_AGENT_OWNERSHIP } from "./agent-ownership.js";
import type { FetchRecentProviderSessionsRequestMessage } from "@getpaseo/protocol/messages";
import {
  IMPORTED_PROVIDER_SESSION_LABEL,
  PARENT_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { createPersistedWorkspaceRecord } from "../workspace-registry.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  type ImportSessionAgentManager,
  ImportSessionsRequestError,
  importProviderSession,
  listImportableProviderSessions,
  normalizeImportAgentRequest,
  normalizeProviderSessionDisplayCwd,
} from "./import-sessions.js";

const directorySymlinkType = process.platform === "win32" ? "junction" : "dir";
const importTestDirectories: string[] = [];

const TEST_CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const directory of importTestDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeImportableSession(args: {
  provider?: string;
  sessionId: string;
  nativeHandle?: string;
  cwd?: string;
  title?: string | null;
  lastActivityAt: string;
  firstPrompt?: string;
  lastPrompt?: string;
}): ManagedImportableProviderSession {
  const provider = args.provider ?? "codex";
  const cwd = args.cwd ?? "/tmp/project";
  return {
    provider,
    providerHandleId: args.nativeHandle ?? args.sessionId,
    cwd,
    title: args.title ?? null,
    lastActivityAt: new Date(args.lastActivityAt),
    firstPromptPreview: args.firstPrompt ?? null,
    lastPromptPreview: args.lastPrompt ?? args.firstPrompt ?? null,
  };
}

function makeImportableSessionsResult(sessions: ManagedImportableProviderSession[]) {
  return { sessions, providerErrors: [] };
}

function makeManagedAgent(args: {
  id?: string;
  provider?: string;
  cwd: string;
  sessionId: string;
  nativeHandle?: string;
  title?: string | null;
}): ManagedAgent {
  const provider = args.provider ?? "codex";
  return {
    id: args.id ?? "00000000-0000-4000-8000-000000000632",
    provider,
    cwd: args.cwd,
    capabilities: TEST_CAPABILITIES,
    config: { provider, cwd: args.cwd, title: args.title },
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-04-30T00:00:00.000Z"),
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    persistence: {
      provider,
      sessionId: args.sessionId,
      ...(args.nativeHandle ? { nativeHandle: args.nativeHandle } : {}),
      metadata: { provider, cwd: args.cwd },
    },
    historyPrimed: true,
    lastUserMessageAt: null,
    lastMessage: { preview: null, role: null, seq: null, messageId: null },
    ownership: INITIAL_AGENT_OWNERSHIP,
    attention: { requiresAttention: false },
    foregroundTurnWaiters: new Set(),
    finalizedForegroundTurnIds: new Set(),
    unsubscribeSession: null,
    internal: false,
    labels: {},
    lifecycle: "closed",
    session: null,
    activeForegroundTurnId: null,
  } satisfies ManagedAgent;
}

function createImportWorkspace(
  workspaceId: string,
): Pick<WorkspaceProvisioningService, "runInImportWorkspace"> {
  return {
    async runInImportWorkspace(input, operation) {
      const workspace = createPersistedWorkspaceRecord({
        workspaceId,
        projectId: `project-${workspaceId}`,
        cwd: input.cwd,
        kind: "directory",
        displayName: "imported",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      });
      return {
        value: await operation(workspace),
        createdWorkspace: null,
      };
    },
  };
}

function makeRequest(
  overrides: Partial<FetchRecentProviderSessionsRequestMessage> = {},
): FetchRecentProviderSessionsRequestMessage {
  return {
    type: "fetch_recent_provider_sessions_request",
    requestId: "recent-provider-sessions",
    ...overrides,
  };
}

test("listImportableProviderSessions filters, sorts, limits, and projects importable sessions", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "outside-cwd",
      nativeHandle: "outside-cwd-handle",
      cwd: "/tmp/elsewhere",
      title: "Outside cwd",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
    }),
    makeImportableSession({
      sessionId: "stored-session",
      nativeHandle: "stored-handle",
      cwd,
      title: "Already stored",
      lastActivityAt: "2026-04-30T12:04:00.000Z",
      firstPrompt: "stored prompt",
    }),
    makeImportableSession({
      sessionId: "older-session",
      nativeHandle: "older-handle",
      cwd,
      title: "Older than since",
      lastActivityAt: "2026-04-29T23:59:59.000Z",
    }),
    makeImportableSession({
      sessionId: "newer-session",
      nativeHandle: "newer-handle",
      cwd,
      title: "Newer import",
      lastActivityAt: "2026-04-30T12:02:00.000Z",
      firstPrompt: "newer first prompt",
      lastPrompt: "newer last prompt",
    }),
    makeImportableSession({
      sessionId: "second-session",
      nativeHandle: "second-handle",
      cwd,
      title: "Second import",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
      firstPrompt: "second prompt",
    }),
    makeImportableSession({
      sessionId: "third-session",
      nativeHandle: "third-handle",
      cwd,
      title: "Third import",
      lastActivityAt: "2026-04-30T11:59:00.000Z",
      firstPrompt: "third prompt",
    }),
    makeImportableSession({
      sessionId: "live-session",
      nativeHandle: "live-handle",
      cwd,
      title: "Already live",
      lastActivityAt: "2026-04-30T12:01:00.000Z",
      firstPrompt: "live prompt",
    }),
  ];
  const listImportableSessions = vi.fn(async () => makeImportableSessionsResult(sessions));
  const agentManager = {
    listAgents: () =>
      [
        {
          id: "agent-live",
          provider: "codex",
          persistence: {
            provider: "codex",
            sessionId: "live-session",
            nativeHandle: "live-handle",
          },
        },
      ] as ManagedAgent[],
    listImportableSessions,
  } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">;
  const agentStorage = {
    list: async () => [
      {
        id: "agent-stored",
        provider: "codex",
        persistence: {
          provider: "codex",
          sessionId: "stored-session",
          nativeHandle: "stored-handle",
        },
      } as StoredAgentRecord,
    ],
  } satisfies Pick<AgentStorage, "list">;

  const result = await listImportableProviderSessions({
    request: makeRequest({
      cwd,
      providers: ["codex"],
      since: "2026-04-30T00:00:00.000Z",
      limit: 2,
    }),
    agentManager,
    agentStorage,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  // S1 (RevServer B5): backfill sizes from the claim index (sessionId + nativeHandle
  // keys for both managed records), not the sessionId-only count — over-sizing is
  // harmless, under-sizing starves the window when rows filter by other keys.
  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 6,
    providerFilter: new Set(["codex"]),
    cwd,
  });
  expect(result).toEqual({
    filteredAlreadyImportedCount: 2,
    // B8-COUNT: 两条在册认领（live agent + stored record），与窗内剩几行无关。
    claimedTotal: 2,
    providerErrors: [],
    entries: [
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerHandleId: "newer-handle",
        cwd,
        title: "Newer import",
        firstPromptPreview: "newer first prompt",
        lastPromptPreview: "newer last prompt",
        lastActivityAt: "2026-04-30T12:02:00.000Z",
      },
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerHandleId: "second-handle",
        cwd,
        title: "Second import",
        firstPromptPreview: "second prompt",
        lastPromptPreview: "second prompt",
        lastActivityAt: "2026-04-30T12:00:00.000Z",
      },
    ],
  });
});

test("listImportableProviderSessions looks past already-imported rows to fill the requested limit", async () => {
  const cwd = "/tmp/project";
  const imported = makeImportableSession({
    provider: "claude",
    sessionId: "already-imported",
    cwd,
    lastActivityAt: "2026-04-30T12:02:00.000Z",
  });
  const available = makeImportableSession({
    provider: "claude",
    sessionId: "available",
    cwd,
    lastActivityAt: "2026-04-30T12:01:00.000Z",
  });
  const listImportableSessions = vi.fn(async (options?: { limit?: number }) =>
    makeImportableSessionsResult([imported, available].slice(0, options?.limit)),
  );

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"], limit: 1 }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions,
    },
    agentStorage: {
      list: async () => [
        {
          provider: "claude",
          persistence: { provider: "claude", sessionId: "already-imported" },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude Code" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 2,
    providerFilter: new Set(["claude"]),
    cwd,
  });
  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["available"]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
});

test("listImportableProviderSessions requests a bounded deep scan for search results", async () => {
  const matchingSessions = [
    makeImportableSession({
      provider: "claude",
      sessionId: "title-match",
      cwd: "/tmp/archive",
      title: "Invoice cleanup",
      lastActivityAt: "2026-04-01T04:00:00.000Z",
    }),
    makeImportableSession({
      provider: "codex",
      sessionId: "first-prompt-match",
      cwd: "/tmp/archive",
      title: "Unrelated",
      firstPrompt: "Investigate invoice totals",
      lastActivityAt: "2026-04-01T03:00:00.000Z",
    }),
    makeImportableSession({
      provider: "pi",
      sessionId: "last-prompt-match",
      cwd: "/tmp/archive",
      title: "Unrelated",
      lastPrompt: "Finish invoice export",
      lastActivityAt: "2026-04-01T02:00:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "cwd-match",
      cwd: "/tmp/invoice-service",
      title: "Unrelated",
      lastActivityAt: "2026-04-01T01:00:00.000Z",
    }),
  ];
  const listImportableSessions = vi.fn(async () => makeImportableSessionsResult(matchingSessions));

  const result = await listImportableProviderSessions({
    request: makeRequest({ query: "INVOICE", limit: 10 }),
    agentManager: { listAgents: () => [], listImportableSessions },
    agentStorage: { list: async () => [] },
    providerSnapshotManager: { getProviderLabel: (provider) => provider },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 500,
    query: "invoice",
    scanLimit: 500,
    providerFilter: undefined,
    cwd: undefined,
  });
  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual([
    "title-match",
    "first-prompt-match",
    "last-prompt-match",
    "cwd-match",
  ]);
});

test("listImportableProviderSessions keeps an archived import out of the list", async () => {
  // R2-19 A-side (FIX-B2 ruling): an ARCHIVED imported session is still an
  // imported session. The old skip-archivedAt read re-listed it as importable
  // (double-import entry) and under-counted filteredAlreadyImportedCount. The
  // revive path (importProviderSession unarchiving the same record) is unchanged
  // and covered by the importProviderSession restore tests below.
  const cwd = "/tmp/project";
  const archivedSession = makeImportableSession({
    provider: "claude",
    sessionId: "archived-session",
    cwd,
    title: "Archived import",
    lastActivityAt: "2026-04-30T12:00:00.000Z",
    firstPrompt: "already imported once",
  });

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => makeImportableSessionsResult([archivedSession]),
    },
    agentStorage: {
      list: async () => [
        {
          provider: "claude",
          archivedAt: "2026-04-30T12:01:00.000Z",
          persistence: {
            provider: "claude",
            sessionId: "archived-session",
          },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.entries).toEqual([]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
});

test("listImportableProviderSessions filters an archived provider session still loaded in memory", async () => {
  // R2-19 A-side, runtime half: the agent object is live in the manager while its
  // stored record carries archivedAt (archive of a loaded tab). Both the runtime
  // loop and the storage loop must count it as imported.
  const cwd = "/tmp/project";
  const agentId = "00000000-0000-4000-8000-000000000633";
  const archivedSession = makeImportableSession({
    provider: "claude",
    sessionId: "archived-live-session",
    cwd,
    title: "Archived live import",
    lastActivityAt: "2026-04-30T12:00:00.000Z",
    firstPrompt: "already imported, still loaded",
  });

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listAgents: () => [
        makeManagedAgent({
          id: agentId,
          provider: "claude",
          cwd,
          sessionId: "archived-live-session",
        }),
      ],
      listImportableSessions: async () => makeImportableSessionsResult([archivedSession]),
    },
    agentStorage: {
      list: async () => [
        {
          id: agentId,
          provider: "claude",
          archivedAt: "2026-04-30T12:01:00.000Z",
          persistence: {
            provider: "claude",
            sessionId: "archived-live-session",
          },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.entries).toEqual([]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
});

test("listImportableProviderSessions filters out metadata generation sessions", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "metadata-session",
      nativeHandle: "metadata-handle",
      cwd,
      title: "Generate metadata for a coding agent based on the user prom...",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
      firstPrompt:
        "Generate metadata for a coding agent based on the user prompt.\nTitle: short descriptive label (<= 40 chars).",
    }),
    makeImportableSession({
      sessionId: "real-session",
      nativeHandle: "real-handle",
      cwd,
      title: "Real session",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
      firstPrompt: "hey hey",
    }),
  ];

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => makeImportableSessionsResult(sessions),
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: {
      list: async () => [],
    } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].providerHandleId).toBe("real-handle");
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

// B5-IMPORT2（F17/D20）：includeExisting 两态 + existing 判定覆盖 原生/导入/归档
// 三路 + omp resume 链祖先（F17-4）。

test("listImportableProviderSessions includeExisting keeps existing rows and marks native/imported/archived", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "native-session",
      nativeHandle: "native-handle",
      cwd,
      title: "Native live",
      lastActivityAt: "2026-04-30T12:03:00.000Z",
    }),
    makeImportableSession({
      sessionId: "imported-session",
      nativeHandle: "imported-handle",
      cwd,
      title: "Imported",
      lastActivityAt: "2026-04-30T12:02:00.000Z",
    }),
    makeImportableSession({
      sessionId: "archived-session",
      nativeHandle: "archived-handle",
      cwd,
      title: "Archived",
      lastActivityAt: "2026-04-30T12:01:00.000Z",
    }),
    makeImportableSession({
      sessionId: "free-session",
      nativeHandle: "free-handle",
      cwd,
      title: "Free",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ];
  const listImportableSessions = vi.fn(async (options?: { limit?: number }) =>
    makeImportableSessionsResult(sessions.slice(0, options?.limit)),
  );

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"], limit: 4, includeExisting: true }),
    agentManager: {
      listAgents: () => [
        makeManagedAgent({
          id: "agent-native",
          cwd,
          sessionId: "native-session",
          nativeHandle: "native-handle",
        }),
      ],
      listImportableSessions,
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: {
      list: async () => [
        {
          id: "agent-imported",
          provider: "codex",
          persistence: {
            provider: "codex",
            sessionId: "imported-session",
            nativeHandle: "imported-handle",
          },
        } as StoredAgentRecord,
        {
          id: "agent-archived",
          provider: "codex",
          archivedAt: "2026-04-30T13:00:00.000Z",
          persistence: {
            provider: "codex",
            sessionId: "archived-session",
            nativeHandle: "archived-handle",
          },
        } as StoredAgentRecord,
      ],
    } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  // includeExisting 不剔除 → 无需回填，listing 只要 limit 行。
  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 4,
    providerFilter: new Set(["codex"]),
    cwd,
  });
  expect(result.filteredAlreadyImportedCount).toBe(0);
  expect(result.entries.map((entry) => [entry.providerHandleId, entry.existing])).toEqual([
    ["native-handle", { agentId: "agent-native", archived: false }],
    ["imported-handle", { agentId: "agent-imported", archived: false }],
    ["archived-handle", { agentId: "agent-archived", archived: true }],
    ["free-handle", undefined],
  ]);
});

test("listImportableProviderSessions existing prefers the active agent over an archived claim", async () => {
  // 归档存量 + 重新导入的活跃体共用一个 handle（B4 壳侧同规则）：标「已导入」
  // 并可跳转活跃体，与服务端拒重复导入的取向一致。
  const cwd = "/tmp/project";
  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"], includeExisting: true }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () =>
        makeImportableSessionsResult([
          makeImportableSession({
            provider: "claude",
            sessionId: "shared-handle",
            cwd,
            lastActivityAt: "2026-04-30T12:00:00.000Z",
          }),
        ]),
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: {
      list: async () => [
        {
          id: "agent-old",
          provider: "claude",
          archivedAt: "2026-04-29T00:00:00.000Z",
          persistence: { provider: "claude", sessionId: "shared-handle" },
        } as StoredAgentRecord,
        {
          id: "agent-new",
          provider: "claude",
          persistence: { provider: "claude", sessionId: "shared-handle" },
        } as StoredAgentRecord,
      ],
    } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Claude Code" },
  });

  expect(result.entries[0].existing).toEqual({ agentId: "agent-new", archived: false });
});

test("listImportableProviderSessions claims omp resume-chain ancestors for the existing verdict", async () => {
  // F17-4 实证（生产 home b0e1e6f7）：omp resume 写新 transcript，header
  // `parentSession` 指旧文件；agent persistence 只跟最新文件。修复前旧文件行
  // 既不剔除也不打标（截图「如果额外问题…」行=本会话祖先）。
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-chain-"));
  importTestDirectories.push(root);
  const cwd = "/tmp/project";
  const parentFile = path.join(root, "2026-09-26T00-00-00-000Z_parent.jsonl");
  const childFile = path.join(root, "2026-09-30T00-00-00-000Z_child.jsonl");
  writeFileSync(
    parentFile,
    `${JSON.stringify({ type: "session", id: "parent-id", cwd, timestamp: "2026-09-26T00:00:00.000Z" })}\n`,
  );
  writeFileSync(
    childFile,
    `${JSON.stringify({ type: "session", id: "child-id", cwd, timestamp: "2026-09-30T00:00:00.000Z", parentSession: parentFile })}\n`,
  );
  const sessions = [
    makeImportableSession({
      provider: "omp",
      sessionId: "child-id",
      nativeHandle: childFile,
      cwd,
      lastActivityAt: "2026-04-30T12:01:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "parent-id",
      nativeHandle: parentFile,
      cwd,
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ];
  const agentManager = {
    listAgents: () => [],
    listImportableSessions: async () => makeImportableSessionsResult(sessions),
  } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">;
  const agentStorage = {
    list: async () => [
      {
        id: "agent-omp",
        provider: "omp",
        persistence: { provider: "omp", sessionId: "child-id", nativeHandle: childFile },
      } as StoredAgentRecord,
    ],
  } satisfies Pick<AgentStorage, "list">;
  const providerSnapshotManager = { getProviderLabel: (provider: string) => provider };

  // 默认态：祖先行=同一已管理会话的历史 → 剔除（修复前它漏网=双导入入口）。
  const filtered = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["omp"] }),
    agentManager,
    agentStorage,
    providerSnapshotManager,
  });
  expect(filtered.entries).toEqual([]);
  expect(filtered.filteredAlreadyImportedCount).toBe(2);

  // includeExisting：两行都在、同标一个 agent。
  const marked = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["omp"], includeExisting: true }),
    agentManager,
    agentStorage,
    providerSnapshotManager,
  });
  expect(marked.entries.map((entry) => [entry.providerHandleId, entry.existing])).toEqual([
    [childFile, { agentId: "agent-omp", archived: false }],
    [parentFile, { agentId: "agent-omp", archived: false }],
  ]);
});

test("listImportableProviderSessions sizes the backfill from the claim index when ancestors filter rows", async () => {
  // S1 (RevServer B5): count 只数 persistence.sessionId key，但 omp 列表行按
  // transcript 路径命中 nativeHandle/祖先 key —— 一条 resume 链剔除 2 行却只
  // 贡献 1 的回填计量，(limit + count) 窗口被已管理行吃光，官方客户端少给行。
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-backfill-"));
  importTestDirectories.push(root);
  const cwd = "/tmp/project";
  const parentFile = path.join(root, "2026-09-26T00-00-00-000Z_parent.jsonl");
  const childFile = path.join(root, "2026-09-30T00-00-00-000Z_child.jsonl");
  const freshFile = path.join(root, "2026-09-29T00-00-00-000Z_fresh.jsonl");
  writeFileSync(
    parentFile,
    `${JSON.stringify({ type: "session", id: "parent-id", cwd, timestamp: "2026-09-26T00:00:00.000Z" })}\n`,
  );
  writeFileSync(
    childFile,
    `${JSON.stringify({ type: "session", id: "child-id", cwd, timestamp: "2026-09-30T00:00:00.000Z", parentSession: parentFile })}\n`,
  );
  const sessions = [
    makeImportableSession({
      provider: "omp",
      sessionId: "child-id",
      nativeHandle: childFile,
      cwd,
      lastActivityAt: "2026-04-30T12:02:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "parent-id",
      nativeHandle: parentFile,
      cwd,
      lastActivityAt: "2026-04-30T12:01:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "fresh-id",
      nativeHandle: freshFile,
      cwd,
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ];
  const listImportableSessions = vi.fn(async (options?: { limit?: number }) =>
    makeImportableSessionsResult(sessions.slice(0, options?.limit)),
  );

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["omp"], limit: 1 }),
    agentManager: { listAgents: () => [], listImportableSessions },
    agentStorage: {
      list: async () => [
        {
          id: "agent-omp",
          provider: "omp",
          persistence: { provider: "omp", sessionId: "child-id", nativeHandle: childFile },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: (provider: string) => provider },
  });

  // 链剔除 2 行（child+祖先）；窗口必须足够深，limit=1 仍要给到下面那条 fresh。
  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual([freshFile]);
  expect(result.filteredAlreadyImportedCount).toBe(2);
});

test("listImportableProviderSessions survives a resume-chain parent path that rejects on read", async () => {
  // S2 (RevServer B5)：parentSession 可以指向一个目录名 *.jsonl —— open() 成功、
  // handle.read() 拒绝（EISDIR；网络盘同形 EIO）。修复前该拒绝穿透 collect，
  // 整个 fetch_recent_provider_sessions 变 rpc_error（两态、含官方客户端）。
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-eisdir-"));
  importTestDirectories.push(root);
  const cwd = "/tmp/project";
  const dirParent = path.join(root, "2026-09-26T00-00-00-000Z_dir.jsonl");
  mkdirSync(dirParent);
  const childFile = path.join(root, "2026-09-30T00-00-00-000Z_child.jsonl");
  writeFileSync(
    childFile,
    `${JSON.stringify({ type: "session", id: "child-id", cwd, timestamp: "2026-09-30T00:00:00.000Z", parentSession: dirParent })}\n`,
  );
  const freshFile = path.join(root, "2026-09-29T00-00-00-000Z_fresh.jsonl");
  const sessions = [
    makeImportableSession({
      provider: "omp",
      sessionId: "child-id",
      nativeHandle: childFile,
      cwd,
      lastActivityAt: "2026-04-30T12:01:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "fresh-id",
      nativeHandle: freshFile,
      cwd,
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ];
  const agentManager = {
    listAgents: () => [],
    listImportableSessions: async () => makeImportableSessionsResult(sessions),
  } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">;
  const agentStorage = {
    list: async () => [
      {
        id: "agent-omp",
        provider: "omp",
        persistence: { provider: "omp", sessionId: "child-id", nativeHandle: childFile },
      } as StoredAgentRecord,
    ],
  } satisfies Pick<AgentStorage, "list">;
  const providerSnapshotManager = { getProviderLabel: (provider: string) => provider };

  const filtered = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["omp"] }),
    agentManager,
    agentStorage,
    providerSnapshotManager,
  });
  expect(filtered.entries.map((entry) => entry.providerHandleId)).toEqual([freshFile]);
  expect(filtered.filteredAlreadyImportedCount).toBe(1);

  const marked = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["omp"], includeExisting: true }),
    agentManager,
    agentStorage,
    providerSnapshotManager,
  });
  expect(marked.entries.map((entry) => entry.existing)).toEqual([
    { agentId: "agent-omp", archived: false },
    undefined,
  ]);
});

test("listImportableProviderSessions tolerates a non-string persisted nativeHandle", async () => {
  // S3 (RevServer B5)：nativeHandle 在持久化 schema 里是 z.any()
  // （agent-projections.test 故意喂 { id: "native" }）。pre-B5 走模板字符串
  // 容忍任何值；B5 守卫直接 .toLowerCase() 把整个列表请求炸成 rpc_error。
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      provider: "omp",
      sessionId: "sess-1",
      cwd,
      lastActivityAt: "2026-04-30T12:01:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "sess-2",
      cwd,
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ];
  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["omp"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => makeImportableSessionsResult(sessions),
    },
    agentStorage: {
      list: async () => [
        {
          id: "agent-omp",
          provider: "omp",
          persistence: { provider: "omp", sessionId: "sess-1", nativeHandle: { id: "native" } },
        } as unknown as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: (provider: string) => provider },
  });
  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["sess-2"]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
});

test.skipIf(process.platform !== "win32")(
  "listImportableProviderSessions claims case-drifted omp resume-chain ancestors",
  async () => {
    // S5 (RevServer B5)：omp 写 parentSession 用的是它当时的拼写，扫描行来自
    // readdir —— 大小写不敏感文件系统上二者可能只差大小写。认领必须走 omp 自己
    // parent-link 用的 sessionPathKey 折叠，否则漂移祖先行继续以双导入入口示人。
    const root = mkdtempSync(path.join(tmpdir(), "paseo-import-casefold-"));
    importTestDirectories.push(root);
    const cwd = "/tmp/project";
    const parentFile = path.join(root, "2026-09-26T00-00-00-000Z_Parent.jsonl");
    const driftedParent = path.join(root, "2026-09-26T00-00-00-000Z_PARENT.JSONL");
    const childFile = path.join(root, "2026-09-30T00-00-00-000Z_child.jsonl");
    writeFileSync(
      parentFile,
      `${JSON.stringify({ type: "session", id: "parent-id", cwd, timestamp: "2026-09-26T00:00:00.000Z" })}\n`,
    );
    writeFileSync(
      childFile,
      `${JSON.stringify({ type: "session", id: "child-id", cwd, timestamp: "2026-09-30T00:00:00.000Z", parentSession: driftedParent })}\n`,
    );
    const sessions = [
      makeImportableSession({
        provider: "omp",
        sessionId: "child-id",
        nativeHandle: childFile,
        cwd,
        lastActivityAt: "2026-04-30T12:01:00.000Z",
      }),
      // 扫描行 = 磁盘拼写；omp 写进 child 头的是漂移拼写。
      makeImportableSession({
        provider: "omp",
        sessionId: "parent-id",
        nativeHandle: parentFile,
        cwd,
        lastActivityAt: "2026-04-30T12:00:00.000Z",
      }),
    ];
    const agentManager = {
      listAgents: () => [],
      listImportableSessions: async () => makeImportableSessionsResult(sessions),
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">;
    const agentStorage = {
      list: async () => [
        {
          id: "agent-omp",
          provider: "omp",
          persistence: { provider: "omp", sessionId: "child-id", nativeHandle: childFile },
        } as StoredAgentRecord,
      ],
    } satisfies Pick<AgentStorage, "list">;
    const providerSnapshotManager = { getProviderLabel: (provider: string) => provider };

    const filtered = await listImportableProviderSessions({
      request: makeRequest({ cwd, providers: ["omp"] }),
      agentManager,
      agentStorage,
      providerSnapshotManager,
    });
    expect(filtered.entries).toEqual([]);
    expect(filtered.filteredAlreadyImportedCount).toBe(2);

    const marked = await listImportableProviderSessions({
      request: makeRequest({ cwd, providers: ["omp"], includeExisting: true }),
      agentManager,
      agentStorage,
      providerSnapshotManager,
    });
    expect(marked.entries.map((entry) => [entry.providerHandleId, entry.existing])).toEqual([
      [childFile, { agentId: "agent-omp", archived: false }],
      [parentFile, { agentId: "agent-omp", archived: false }],
    ]);
  },
);

test("listImportableProviderSessions keeps metadata-generation sessions hidden under includeExisting", async () => {
  // B5-IMPORT2 裁定（用户明示「那就不显示 metadata」）：恒隐，两态一致。
  const cwd = "/tmp/project";
  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"], includeExisting: true }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () =>
        makeImportableSessionsResult([
          makeImportableSession({
            sessionId: "metadata-session",
            nativeHandle: "metadata-handle",
            cwd,
            lastActivityAt: "2026-04-30T12:05:00.000Z",
            firstPrompt:
              "Generate metadata for a coding agent based on the user prompt.\nTitle: short descriptive label (<= 40 chars).",
          }),
        ]),
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: { list: async () => [] } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries).toEqual([]);
});

test("listImportableProviderSessions keeps realpath-equivalent cwd matches", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-cwd-"));
  const realCwd = path.join(root, "real-project");
  const linkedCwd = path.join(root, "linked-project");
  mkdirSync(realCwd, { recursive: true });
  symlinkSync(realCwd, linkedCwd, directorySymlinkType);
  const persistedCwd = realpathSync(linkedCwd);

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd: linkedCwd, providers: ["pi"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () =>
        makeImportableSessionsResult([
          makeImportableSession({
            provider: "pi",
            sessionId: "pi-session",
            nativeHandle: "pi-handle",
            cwd: persistedCwd,
            title: "Pi session",
            lastActivityAt: "2026-04-30T12:00:00.000Z",
            firstPrompt: "remember this",
          }),
        ]),
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: {
      list: async () => [],
    } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Pi" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["pi-handle"]);
});

test("listImportableProviderSessions counts claimedTotal over the full claim index, deduped by conversation", async () => {
  // F24 根因=两口径不同轴：徽标只落在（agent ∩ 返回窗 ∩ handle 命中）的行上，
  // 对话列表数=全部在册 agent。claimedTotal 报后者：窗外存量要算进去（本例
  // agent-old 的 transcript 已被扫描窗甩掉，没有行可标），一个 agent 的多个
  // key（sessionId/nativeHandle/resume 链祖先/大小写折叠拼法）只算一条会话。
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-claimed-"));
  importTestDirectories.push(root);
  const cwd = "/tmp/project";
  const parentFile = path.join(root, "2026-09-26T00-00-00-000Z_parent.jsonl");
  const childFile = path.join(root, "2026-09-30T00-00-00-000Z_child.jsonl");
  writeFileSync(
    parentFile,
    `${JSON.stringify({ type: "session", id: "parent-id", cwd, timestamp: "2026-09-26T00:00:00.000Z" })}\n`,
  );
  writeFileSync(
    childFile,
    `${JSON.stringify({ type: "session", id: "child-id", cwd, timestamp: "2026-09-30T00:00:00.000Z", parentSession: parentFile })}\n`,
  );
  // 窗内三行：一条被 agent-in-window 认领、两条是 agent-chain 的同一会话
  // （现行 + 祖先），第四条 h-free 无人认领=唯一还能导入的行。
  const listed = [
    makeImportableSession({
      sessionId: "s-in",
      nativeHandle: "h-in",
      cwd,
      lastActivityAt: "2026-04-30T12:03:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "child-id",
      nativeHandle: childFile,
      cwd,
      lastActivityAt: "2026-04-30T12:02:00.000Z",
    }),
    makeImportableSession({
      provider: "omp",
      sessionId: "parent-id",
      nativeHandle: parentFile,
      cwd,
      lastActivityAt: "2026-04-30T12:01:00.000Z",
    }),
    makeImportableSession({
      sessionId: "s-free",
      nativeHandle: "h-free",
      cwd,
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ];
  const listImportableSessions = vi.fn(async (options?: { limit?: number; query?: string }) =>
    options?.query
      ? makeImportableSessionsResult([])
      : makeImportableSessionsResult(listed.slice(0, options?.limit)),
  );
  const agentManager = {
    listAgents: () => [],
    listImportableSessions,
  } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">;
  const agentStorage = {
    list: async () =>
      [
        {
          id: "agent-in-window",
          provider: "codex",
          persistence: { provider: "codex", sessionId: "s-in", nativeHandle: "h-in" },
        },
        // 窗外存量：listing 根本不返回它的 transcript。
        {
          id: "agent-old",
          provider: "codex",
          archivedAt: "2026-04-29T00:00:00.000Z",
          persistence: { provider: "codex", sessionId: "s-old", nativeHandle: "h-old" },
        },
        {
          id: "agent-chain",
          provider: "omp",
          persistence: { provider: "omp", sessionId: "child-id", nativeHandle: childFile },
        },
      ] as StoredAgentRecord[],
  } satisfies Pick<AgentStorage, "list">;
  const providerSnapshotManager = { getProviderLabel: (provider: string) => provider };

  const windowed = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex", "omp"], limit: 1 }),
    agentManager,
    agentStorage,
    providerSnapshotManager,
  });
  expect(windowed.entries.map((entry) => entry.providerHandleId)).toEqual(["h-free"]);
  expect(windowed.claimedTotal).toBe(3);

  // 搜索窗是另一条 limit/scanLimit 路径：一行不剩也不动全量计数。
  const searched = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex", "omp"], query: "no-such-session" }),
    agentManager,
    agentStorage,
    providerSnapshotManager,
  });
  expect(searched.entries).toEqual([]);
  expect(searched.claimedTotal).toBe(3);
});

test("normalizeProviderSessionDisplayCwd folds Windows spellings and leaves POSIX case alone", () => {
  // 追加口径钉的等值对：同一目录的两种写法必须归一到同一串。
  expect(normalizeProviderSessionDisplayCwd("c:\\work\\paseo-go")).toBe("C:/work/paseo-go");
  expect(normalizeProviderSessionDisplayCwd("c:\\work\\paseo-go")).toBe(
    normalizeProviderSessionDisplayCwd("C:/work/paseo-go"),
  );
  expect(normalizeProviderSessionDisplayCwd("C:\\work\\paseo-go\\")).toBe("C:/work/paseo-go");
  expect(normalizeProviderSessionDisplayCwd("c:/work//paseo-go/./.dev")).toBe(
    "C:/work/paseo-go/.dev",
  );
  expect(normalizeProviderSessionDisplayCwd("\\\\?\\c:\\work\\paseo-go")).toBe("C:/work/paseo-go");
  expect(normalizeProviderSessionDisplayCwd("\\\\server\\share\\repo")).toBe("//server/share/repo");
  // POSIX 大小写有意义（/home/User 与 /home/user 是两个目录）→ 原样返回。
  expect(normalizeProviderSessionDisplayCwd("/home/User/Project")).toBe("/home/User/Project");
});

test("listImportableProviderSessions projects a Windows cwd in one spelling without touching the handle", async () => {
  const windowsCwd = "c:\\work\\paseo-go";
  const transcript = "c:\\Users\\K\\.omp\\agent\\2026-10-01_chat.jsonl";
  const result = await listImportableProviderSessions({
    request: makeRequest({ providers: ["omp"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () =>
        makeImportableSessionsResult([
          makeImportableSession({
            provider: "omp",
            sessionId: "omp-session",
            nativeHandle: transcript,
            cwd: windowsCwd,
            lastActivityAt: "2026-04-30T12:00:00.000Z",
          }),
        ]),
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: { list: async () => [] } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "OMP" },
  });

  expect(result.entries[0]?.cwd).toBe("C:/work/paseo-go");
  // handle=认领键/去重键的输入，一个字符都不能动。
  expect(result.entries[0]?.providerHandleId).toBe(transcript);
  expect(result.claimedTotal).toBe(0);
});

test("listImportableProviderSessions rejects invalid since values", async () => {
  await expect(
    listImportableProviderSessions({
      request: makeRequest({ since: "not-a-date" }),
      agentManager: {
        listAgents: () => [],
        listImportableSessions: async () => makeImportableSessionsResult([]),
      } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
      agentStorage: {
        list: async () => [],
      } satisfies Pick<AgentStorage, "list">,
      providerSnapshotManager: { getProviderLabel: () => "" },
    }),
  ).rejects.toMatchObject(
    new ImportSessionsRequestError("invalid_since", "Invalid recent provider sessions since"),
  );
});

test("normalizeImportAgentRequest accepts new and legacy import handle shapes", () => {
  expect(
    normalizeImportAgentRequest({
      type: "import_agent_request",
      requestId: "new-shape",
      providerId: "custom-codex",
      providerHandleId: "thread-1",
    }),
  ).toEqual({
    requestId: "new-shape",
    provider: "custom-codex",
    providerHandleId: "thread-1",
  });

  expect(
    normalizeImportAgentRequest({
      type: "import_agent_request",
      requestId: "legacy-shape",
      provider: "codex",
      sessionId: "thread-2",
    }),
  ).toEqual({
    requestId: "legacy-shape",
    provider: "codex",
    providerHandleId: "thread-2",
  });
});

function makeStoredProviderSession(input: {
  id: string;
  cwd: string;
  sessionId: string;
  nativeHandle?: string;
  workspaceId?: string;
  labels?: Record<string, string>;
  archivedAt?: string | null;
}): StoredAgentRecord {
  return {
    id: input.id,
    provider: "codex",
    cwd: input.cwd,
    workspaceId: input.workspaceId ?? "ws-archived",
    createdAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T11:00:00.000Z",
    lastActivityAt: "2026-04-30T10:30:00.000Z",
    lastUserMessageAt: null,
    labels: input.labels ?? {},
    config: { provider: "codex", cwd: input.cwd },
    persistence: {
      provider: "codex",
      sessionId: input.sessionId,
      nativeHandle: input.nativeHandle ?? input.sessionId,
      metadata: { provider: "codex", cwd: input.cwd },
    },
    archivedAt: input.archivedAt === undefined ? "2026-04-30T12:00:00.000Z" : input.archivedAt,
  };
}

class ProviderImportHarness {
  readonly storage: AgentStorage;
  readonly manager: ImportSessionAgentManager;
  readonly snapshot: ManagedAgent;
  readonly freshImports: unknown[] = [];
  readonly closedAgentIds: string[] = [];
  /** R4-30: the handles this fake provider currently lists as importable. */
  importableHandleIds: string[];
  timeline: AgentTimelineItem[] = [];
  activeAgent: ManagedAgent | null = null;
  resumeError: Error | null = null;
  resumeAttempts = 0;
  private unarchiveWait: Promise<void> | null = null;
  private releaseUnarchive: (() => void) | null = null;

  private constructor(input: { storage: AgentStorage; snapshot: ManagedAgent }) {
    this.storage = input.storage;
    this.snapshot = input.snapshot;
    this.importableHandleIds = [input.snapshot.persistence?.sessionId ?? ""];
    this.manager = {
      importProviderSession: async (request: unknown) => {
        this.freshImports.push(request);
        this.activeAgent = this.snapshot;
        return this.snapshot;
      },
      unarchiveSnapshot: async (
        agentId: string,
        updates?: { workspaceId?: string; labels?: Record<string, string | null> },
      ) => {
        if (this.unarchiveWait) {
          await this.unarchiveWait;
        }
        const record = await this.storage.get(agentId);
        if (!record?.archivedAt) {
          return false;
        }
        const labels = { ...record.labels };
        for (const [key, value] of Object.entries(updates?.labels ?? {})) {
          if (value === null) {
            delete labels[key];
          } else {
            labels[key] = value;
          }
        }
        await this.storage.upsert({
          ...record,
          workspaceId: updates?.workspaceId ?? record.workspaceId,
          labels,
          archivedAt: null,
        });
        return true;
      },
      notifyAgentState: () => {},
      getAgent: () => this.activeAgent,
      getRegisteredProviderIds: () => ["codex"],
      createAgent: async () => {
        throw new Error("Stored provider imports must resume their persisted session");
      },
      resumeAgentFromPersistence: async (
        _handle: unknown,
        _overrides: unknown,
        _agentId?: string,
        _options?: unknown,
      ) => {
        this.resumeAttempts += 1;
        if (this.resumeError) {
          this.activeAgent = this.snapshot;
          throw this.resumeError;
        }
        this.activeAgent = this.snapshot;
        return this.snapshot;
      },
      hydrateTimelineFromProvider: async () => {},
      getTimeline: () => this.timeline,
      closeAgent: async (agentId: string) => {
        this.closedAgentIds.push(agentId);
        this.activeAgent = null;
      },
      archiveSnapshot: async (agentId: string, archivedAt: string) => {
        const record = await this.storage.get(agentId);
        if (!record) {
          throw new Error("Agent not found: " + agentId);
        }
        const archived = { ...record, archivedAt };
        await this.storage.upsert(archived);
        return archived;
      },
      listImportableSessions: async () =>
        makeImportableSessionsResult(
          this.importableHandleIds.map((handleId) =>
            makeImportableSession({
              sessionId: handleId,
              cwd: this.snapshot.cwd,
              lastActivityAt: "2026-04-30T00:00:00.000Z",
            }),
          ),
        ),
    } satisfies ImportSessionAgentManager;
  }

  static async create(
    input: {
      id?: string;
      cwd?: string;
      sessionId?: string;
      nativeHandle?: string;
    } = {},
  ): Promise<ProviderImportHarness> {
    const directory = mkdtempSync(path.join(tmpdir(), "provider-import-"));
    importTestDirectories.push(directory);
    const storage = new AgentStorage(path.join(directory, "agents"), createTestLogger());
    await storage.initialize();
    const cwd = input.cwd ?? "/tmp/imported-agent";
    const sessionId = input.sessionId ?? "thread-imported";
    const snapshot = makeManagedAgent({
      id: input.id,
      provider: "codex",
      cwd,
      sessionId,
      nativeHandle: input.nativeHandle,
    });
    return new ProviderImportHarness({ storage, snapshot });
  }

  async seed(record: StoredAgentRecord): Promise<void> {
    await this.storage.upsert(record);
  }

  blockUnarchive(): () => void {
    this.unarchiveWait = new Promise<void>((resolve) => {
      this.releaseUnarchive = resolve;
    });
    return () => {
      this.releaseUnarchive?.();
      this.unarchiveWait = null;
      this.releaseUnarchive = null;
    };
  }

  import(input: { providerHandleId: string; cwd?: string; labels?: Record<string, string> }) {
    return importProviderSession({
      request: {
        requestId: "import-thread",
        provider: "codex",
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
        labels: input.labels,
      },
      workspaceProvisioning: createImportWorkspace("ws-restored"),
      agentManager: this.manager,
      agentStorage: this.storage,
      logger: createTestLogger(),
    });
  }
}

test("importProviderSession uses the provider import path with the requested labels", async () => {
  const harness = await ProviderImportHarness.create();
  harness.timeline = [
    { type: "user_message", text: "Trace recent provider sessions" },
    { type: "assistant_message", text: "I will inspect the provider listing." },
  ];

  const result = await harness.import({
    providerHandleId: "thread-imported",
    cwd: "/tmp/imported-agent",
    labels: { source: "import" },
  });

  expect(harness.freshImports).toEqual([
    {
      provider: "codex",
      providerHandleId: "thread-imported",
      cwd: "/tmp/imported-agent",
      workspaceId: "ws-restored",
      labels: { source: "import" },
    },
  ]);
  expect(result).toEqual({
    snapshot: harness.snapshot,
    timelineSize: 2,
    createdWorkspace: null,
  });
});

test("importProviderSession refuses a handle the provider does not list (R4-30)", async () => {
  // `providerHandleId` is a client string that becomes the persisted handle
  // the transcript watcher tails for the agent's whole life. Only handles the
  // provider itself lists right now may reach storage.
  const harness = await ProviderImportHarness.create();
  await expect(
    harness.import({
      providerHandleId: "/home/victim/.omp/sessions/planted.jsonl",
      cwd: "/tmp/imported-agent",
    }),
  ).rejects.toThrow("Provider session is not currently importable");
  expect(harness.freshImports).toEqual([]);

  // Once the provider lists it, the same import proceeds.
  harness.importableHandleIds.push("/home/victim/.omp/sessions/planted.jsonl");
  await expect(
    harness.import({
      providerHandleId: "/home/victim/.omp/sessions/planted.jsonl",
      cwd: "/tmp/imported-agent",
    }),
  ).resolves.toMatchObject({ snapshot: { id: harness.snapshot.id } });
  expect(harness.freshImports).toHaveLength(1);
});

test("importProviderSession rejects a provider session with an active stored owner", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-active" });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "thread-active",
      archivedAt: null,
    }),
  );

  await expect(
    harness.import({ providerHandleId: "thread-active", cwd: harness.snapshot.cwd }),
  ).rejects.toThrow("Provider session is already imported: thread-active");
  expect(harness.freshImports).toEqual([]);
});

test("importProviderSession restores an archived session as the same standalone agent", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-archived" });
  harness.timeline = [{ type: "user_message", text: "restored" }];
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: harness.snapshot.cwd,
    sessionId: "thread-archived",
    labels: { existing: "label", [PARENT_AGENT_ID_LABEL]: "archived-parent" },
  });
  await harness.seed(archived);

  const result = await harness.import({
    providerHandleId: "thread-archived",
    cwd: harness.snapshot.cwd,
    labels: { source: "reimport" },
  });

  expect(result).toEqual({
    snapshot: harness.snapshot,
    timelineSize: 1,
    createdWorkspace: null,
  });
  expect(await harness.storage.get(harness.snapshot.id)).toMatchObject({
    id: harness.snapshot.id,
    workspaceId: "ws-restored",
    labels: { existing: "label", source: "reimport" },
    archivedAt: null,
  });
  expect((await harness.storage.get(harness.snapshot.id))?.labels).not.toHaveProperty(
    PARENT_AGENT_ID_LABEL,
  );
  expect((await harness.storage.get(harness.snapshot.id))?.labels).toHaveProperty(
    IMPORTED_PROVIDER_SESSION_LABEL,
    "true",
  );
  expect(harness.resumeAttempts).toBe(1);
  expect(harness.freshImports).toEqual([]);
});

test("importProviderSession rejects an archived session from a different cwd before restoring", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-other-cwd" });
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: "/tmp/other-agent",
    sessionId: "thread-other-cwd",
  });
  await harness.seed(archived);

  await expect(
    harness.import({ providerHandleId: "thread-other-cwd", cwd: "/tmp/target-agent" }),
  ).rejects.toThrow("Provider session cwd does not match import cwd: thread-other-cwd");
  expect(await harness.storage.get(harness.snapshot.id)).toEqual(archived);
  expect(harness.resumeAttempts).toBe(0);
});

test("importProviderSession restores storage and closes a partial runtime when loading fails", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-stale" });
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: harness.snapshot.cwd,
    sessionId: "thread-stale",
  });
  await harness.seed(archived);
  harness.resumeError = new Error("provider session is unavailable");

  await expect(
    harness.import({ providerHandleId: "thread-stale", cwd: harness.snapshot.cwd }),
  ).rejects.toThrow("provider session is unavailable");

  expect(await harness.storage.get(harness.snapshot.id)).toEqual(archived);
  expect(harness.activeAgent).toBeNull();
  expect(harness.closedAgentIds).toEqual([harness.snapshot.id]);
});

test("importProviderSession serializes legacy and native aliases for one archived session", async () => {
  const harness = await ProviderImportHarness.create({
    sessionId: "legacy-thread",
    nativeHandle: "native-thread",
  });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "legacy-thread",
      nativeHandle: "native-thread",
    }),
  );
  const releaseUnarchive = harness.blockUnarchive();

  const winningRestore = harness.import({
    providerHandleId: "native-thread",
    cwd: harness.snapshot.cwd,
  });
  const duplicateRestore = harness.import({
    providerHandleId: "legacy-thread",
    cwd: harness.snapshot.cwd,
  });
  releaseUnarchive();

  await expect(winningRestore).resolves.toMatchObject({
    snapshot: { id: harness.snapshot.id },
    timelineSize: 0,
  });
  await expect(duplicateRestore).rejects.toThrow(
    "Provider session is already imported: legacy-thread",
  );
  expect(harness.resumeAttempts).toBe(1);
  expect(harness.closedAgentIds).toEqual([]);
});

test("importProviderSession requires cwd from the selected provider row", async () => {
  const harness = await ProviderImportHarness.create();

  await expect(harness.import({ providerHandleId: "thread-imported" })).rejects.toThrow(
    "Import requires cwd from the selected provider session",
  );
});
