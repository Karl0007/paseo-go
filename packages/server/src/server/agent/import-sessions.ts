import type { z } from "zod";
import type { Logger } from "pino";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type {
  AgentManager,
  ManagedAgent,
  ManagedImportableProviderSession,
} from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { AgentPersistenceHandle, AgentProvider } from "./agent-sdk-types.js";
import { ensureAgentLoaded, type AgentLoaderManager } from "./agent-loading.js";
import { unarchiveAgentState } from "./agent-prompt.js";
import { toRecentProviderSessionDescriptorPayload } from "./agent-projections.js";
import { resolveOmpResumeAncestorPaths } from "./providers/omp/session-descriptor.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type {
  FetchRecentProviderSessionsRequestMessage,
  ImportAgentRequestMessageSchema,
  RecentProviderSessionDescriptorPayload,
} from "@getpaseo/protocol/messages";
import {
  getParentAgentIdFromLabels,
  IMPORTED_PROVIDER_SESSION_LABEL,
  PARENT_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";
import { createRealpathAwarePathMatcher } from "../../utils/path.js";

type ImportAgentRequestMessage = z.infer<typeof ImportAgentRequestMessageSchema>;

const METADATA_GENERATION_PROMPT_PREFIX =
  "Generate metadata for a coding agent based on the user prompt.";
const IMPORT_SESSION_SEARCH_SCAN_LIMIT = 500;
export type ImportSessionAgentManager = AgentLoaderManager &
  Pick<
    AgentManager,
    | "archiveSnapshot"
    | "closeAgent"
    | "getTimeline"
    | "importProviderSession"
    | "listImportableSessions"
    | "notifyAgentState"
    | "unarchiveSnapshot"
  >;

const providerSessionImportMutations = new WeakMap<
  ImportSessionAgentManager,
  Map<string, Promise<unknown>>
>();

export interface NormalizedImportAgentRequest {
  provider: AgentProvider;
  providerHandleId: string;
  cwd?: string;
  workspaceId?: string;
  labels?: Record<string, string>;
  requestId: string;
}

export class ImportSessionsRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportSessionsRequestError";
  }
}

export interface ListImportableProviderSessionsInput {
  request: FetchRecentProviderSessionsRequestMessage;
  agentManager: Pick<AgentManager, "listAgents" | "listImportableSessions">;
  agentStorage: Pick<AgentStorage, "list">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "getProviderLabel">;
}

export interface ListImportableProviderSessionsResult {
  entries: RecentProviderSessionDescriptorPayload[];
  filteredAlreadyImportedCount: number;
  providerErrors: Array<{ provider: string; message: string }>;
}

/** Which managed agent a provider session already belongs to (B5-IMPORT2 `existing`). */
interface ExistingAgentFacts {
  agentId: string;
  archived: boolean;
}

export interface ImportProviderSessionInput {
  request: NormalizedImportAgentRequest;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "runInImportWorkspace">;
  agentManager: ImportSessionAgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

export interface ImportProviderSessionResult {
  snapshot: ManagedAgent;
  timelineSize: number;
  createdWorkspace: PersistedWorkspaceRecord | null;
}

interface ImportedProviderSession {
  snapshot: ManagedAgent;
  timelineSize: number;
}

// COMPAT(import-agent-request-v1): accept legacy {provider, sessionId} shape
// alongside the new {providerId, providerHandleId} shape. Old clients
// (< target daemon floor) send the legacy fields. Drop the fallbacks and the
// .optional() in messages.ts when the supported client floor is >= the daemon
// version that ships the new shape (target: 2026-11-08).
export function normalizeImportAgentRequest(
  msg: ImportAgentRequestMessage,
): NormalizedImportAgentRequest | { error: string } {
  const provider = msg.providerId ?? msg.provider;
  const providerHandleId = msg.providerHandleId ?? msg.sessionId;
  if (!provider || !providerHandleId) {
    return { error: "Import requires providerId and providerHandleId" };
  }
  return {
    provider: provider as AgentProvider,
    providerHandleId,
    cwd: msg.cwd,
    workspaceId: msg.workspaceId,
    labels: msg.labels,
    requestId: msg.requestId,
  };
}

export async function listImportableProviderSessions(
  input: ListImportableProviderSessionsInput,
): Promise<ListImportableProviderSessionsResult> {
  const { request, agentManager, agentStorage, providerSnapshotManager } = input;
  // B5-IMPORT2 (D20): `includeExisting` flips the already-existing verdict from
  // 「剔除」to「保留+标记」. Absent/false keeps the pre-B5 path byte-for-byte:
  // existing rows are filtered and counted into `filteredAlreadyImportedCount`.
  const includeExisting = request.includeExisting === true;
  const limit = request.limit ?? 20;
  const sinceTimestamp = parseRecentProviderSessionsSince(request.since);
  const providerFilter = request.providers ? new Set(request.providers) : undefined;
  const importedSessions = await collectImportedProviderSessions(
    agentManager,
    agentStorage,
    providerFilter,
  );
  const importedIndex = importedSessions.index;
  const query = normalizeImportSessionQuery(request.query);
  // The backfill past filtered rows only matters when rows ARE filtered;
  // includeExisting keeps every row, so `limit` listings are enough.
  let listingLimit: number;
  if (query) {
    listingLimit = IMPORT_SESSION_SEARCH_SCAN_LIMIT;
  } else if (includeExisting) {
    listingLimit = limit;
  } else {
    listingLimit = limit + importedSessions.count;
  }

  const listing = await agentManager.listImportableSessions({
    limit: listingLimit,
    ...(query ? { query } : {}),
    ...(query ? { scanLimit: IMPORT_SESSION_SEARCH_SCAN_LIMIT } : {}),
    providerFilter,
    cwd: request.cwd,
  });
  let filteredAlreadyImportedCount = 0;
  const candidates: ManagedImportableProviderSession[] = [];
  const matchesRequestCwd = request.cwd ? createRealpathAwarePathMatcher(request.cwd) : null;
  for (const session of listing.sessions) {
    if (matchesRequestCwd && !matchesRequestCwd(session.cwd)) {
      continue;
    }
    if (sinceTimestamp !== null && session.lastActivityAt.getTime() < sinceTimestamp) {
      continue;
    }
    // metadata-generation 恒隐（B5-IMPORT2 裁定）：includeExisting 也不放行——
    // 用户明示这类会话不进导入页。
    if (isMetadataGenerationSession(session)) {
      continue;
    }
    if (importedIndex.has(toProviderSessionHandleKey(session.provider, session.providerHandleId))) {
      if (!includeExisting) {
        filteredAlreadyImportedCount += 1;
        continue;
      }
    }
    candidates.push(session);
  }

  const entries = candidates
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
    .slice(0, limit)
    .map((descriptor) => {
      const payload = toRecentProviderSessionDescriptorPayload(descriptor, {
        providerLabel: providerSnapshotManager.getProviderLabel(descriptor.provider),
      });
      if (includeExisting) {
        const facts = importedIndex.get(
          toProviderSessionHandleKey(descriptor.provider, descriptor.providerHandleId),
        );
        if (facts) {
          payload.existing = { agentId: facts.agentId, archived: facts.archived };
        }
      }
      return payload;
    });

  return {
    entries,
    filteredAlreadyImportedCount,
    providerErrors: listing.providerErrors,
  };
}

function normalizeImportSessionQuery(query: string | undefined): string | null {
  const normalized = query?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export async function importProviderSession(
  input: ImportProviderSessionInput,
): Promise<ImportProviderSessionResult> {
  const cwd = input.request.cwd;
  if (!cwd) {
    throw new Error("Import requires cwd from the selected provider session");
  }
  const key = await resolveProviderSessionImportMutationKey(input);
  return serializeProviderSessionImport(input.agentManager, key, async () => {
    const placement = await input.workspaceProvisioning.runInImportWorkspace(
      { cwd, requestedWorkspaceId: input.request.workspaceId },
      (workspace) => importProviderSessionNow(input, cwd, workspace.workspaceId),
    );
    return { ...placement.value, createdWorkspace: placement.createdWorkspace };
  });
}

async function importProviderSessionNow(
  input: ImportProviderSessionInput,
  cwd: string,
  workspaceId: string,
): Promise<ImportedProviderSession> {
  const { provider, providerHandleId, labels } = input.request;

  const matchingRecords = await input.agentStorage.listByProviderSession(
    provider,
    providerHandleId,
  );
  const activeRecord = matchingRecords.find((record) => !record.archivedAt);
  if (activeRecord) {
    throw new Error(`Provider session is already imported: ${providerHandleId}`);
  }
  const archivedRecord = matchingRecords.find((record) => record.archivedAt);
  if (archivedRecord?.persistence && archivedRecord.archivedAt) {
    if (!createRealpathAwarePathMatcher(cwd)(archivedRecord.cwd)) {
      throw new Error(`Provider session cwd does not match import cwd: ${providerHandleId}`);
    }
    const requestedParentAgentId = getParentAgentIdFromLabels(input.request.labels);
    const labelPatch: Record<string, string | null> = { ...input.request.labels };
    if (
      Object.hasOwn(archivedRecord.labels, PARENT_AGENT_ID_LABEL) ||
      Object.hasOwn(input.request.labels ?? {}, PARENT_AGENT_ID_LABEL)
    ) {
      labelPatch[PARENT_AGENT_ID_LABEL] = requestedParentAgentId;
    }
    if (!Object.hasOwn(archivedRecord.labels, IMPORTED_PROVIDER_SESSION_LABEL)) {
      // Archived records predating the provenance stamp get it backfilled on re-import.
      labelPatch[IMPORTED_PROVIDER_SESSION_LABEL] = "true";
    }
    await unarchiveAgentState(input.agentStorage, input.agentManager, archivedRecord.id, {
      workspaceId,
      labels: Object.keys(labelPatch).length > 0 ? labelPatch : undefined,
    });
    try {
      const snapshot = await ensureAgentLoaded(archivedRecord.id, {
        agentManager: input.agentManager,
        agentStorage: input.agentStorage,
        logger: input.logger,
      });
      return {
        snapshot,
        timelineSize: input.agentManager.getTimeline(snapshot.id).length,
      };
    } catch (error) {
      await rollbackArchivedImport(input, archivedRecord, archivedRecord.archivedAt);
      throw error;
    }
  }

  // R4-30: `providerHandleId` is a client string that becomes the persisted
  // handle the transcript watcher tails for the life of the agent (watcher
  // tail + content echo is this batch's extension of the one-shot import read).
  // Accept only handles the provider itself lists right now: the import UI
  // picks from exactly this listing, so a legitimate selection always passes,
  // while a planted handle (arbitrary .jsonl path) never reaches storage.
  const revalidation = await input.agentManager.listImportableSessions({
    limit: IMPORT_SESSION_SEARCH_SCAN_LIMIT,
    providerFilter: new Set([provider]),
    cwd,
  });
  if (
    revalidation.providerErrors.some((error) => error.provider === provider) ||
    !revalidation.sessions.some((session) => session.providerHandleId === providerHandleId)
  ) {
    throw new ImportSessionsRequestError(
      "not_importable",
      `Provider session is not currently importable: ${providerHandleId}`,
    );
  }
  const snapshot = await input.agentManager.importProviderSession({
    provider,
    providerHandleId,
    cwd,
    workspaceId,
    labels,
  });
  await unarchiveAgentState(input.agentStorage, input.agentManager, snapshot.id);

  return {
    snapshot,
    timelineSize: input.agentManager.getTimeline(snapshot.id).length,
  };
}

async function serializeProviderSessionImport<T>(
  agentManager: ImportSessionAgentManager,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  let mutations = providerSessionImportMutations.get(agentManager);
  if (!mutations) {
    mutations = new Map();
    providerSessionImportMutations.set(agentManager, mutations);
  }

  const previous = mutations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  mutations.set(key, next);
  try {
    return await next;
  } finally {
    if (mutations.get(key) === next) {
      mutations.delete(key);
    }
  }
}

async function resolveProviderSessionImportMutationKey(
  input: ImportProviderSessionInput,
): Promise<string> {
  const matchingRecord = (
    await input.agentStorage.listByProviderSession(
      input.request.provider,
      input.request.providerHandleId,
    )
  ).at(0);
  return matchingRecord
    ? `agent\0${matchingRecord.id}`
    : `handle\0${toProviderSessionHandleKey(
        input.request.provider,
        input.request.providerHandleId,
      )}`;
}

async function rollbackArchivedImport(
  input: ImportProviderSessionInput,
  archivedRecord: StoredAgentRecord,
  archivedAt: string,
): Promise<void> {
  try {
    if (input.agentManager.getAgent(archivedRecord.id)) {
      await input.agentManager.closeAgent(archivedRecord.id);
    }
    await input.agentManager.archiveSnapshot(archivedRecord.id, archivedAt);
  } catch (error) {
    input.logger.error(
      { err: error, agentId: archivedRecord.id },
      "Failed to re-archive provider session after import failure",
    );
  }

  try {
    await input.agentStorage.upsert(archivedRecord);
  } catch (error) {
    input.logger.error(
      { err: error, agentId: archivedRecord.id },
      "Failed to restore archived agent record after import failure",
    );
  }
}

function parseRecentProviderSessionsSince(since: string | undefined): number | null {
  if (!since) {
    return null;
  }
  const timestamp = Date.parse(since);
  if (Number.isNaN(timestamp)) {
    throw new ImportSessionsRequestError("invalid_since", "Invalid recent provider sessions since");
  }
  return timestamp;
}

async function collectImportedProviderSessions(
  agentManager: Pick<AgentManager, "listAgents">,
  agentStorage: Pick<AgentStorage, "list">,
  providerFilter: Set<string> | undefined,
): Promise<{ index: Map<string, ExistingAgentFacts>; count: number }> {
  const index = new Map<string, ExistingAgentFacts>();
  // count keeps the pre-B5 semantics (distinct persistence.sessionId keys) — it
  // sizes the filtered-row backfill (listingLimit) for the default mode.
  const sessions = new Set<string>();
  const records = await agentStorage.list();
  // F17-4: an omp resume writes a NEW transcript whose header `parentSession`
  // points at the file it resumed from; the agent handle only tracks the newest
  // file. Walking the chain claims the ancestors too — same conversation,
  // already managed (default mode filters them, includeExisting badges them).
  const chainCache = new Map<string, Promise<string[]>>();

  const addKey = (provider: string, handle: string, facts: ExistingAgentFacts): void => {
    const key = toProviderSessionHandleKey(provider, handle);
    const prev = index.get(key);
    // Active claims win over archived ones — same direction as the daemon's
    // duplicate-import rejection (checks activeRecord first) and as the shell's
    // B4 handle index.
    if (!prev || (prev.archived && !facts.archived)) {
      index.set(key, facts);
    }
  };

  const collect = async (
    provider: AgentProvider | StoredAgentRecord["provider"] | string,
    persistence: AgentPersistenceHandle | null | undefined,
    facts: ExistingAgentFacts,
  ): Promise<void> => {
    if (!persistence || (providerFilter && !providerFilter.has(provider))) return;
    sessions.add(toProviderSessionHandleKey(provider, persistence.sessionId));
    addKey(provider, persistence.sessionId, facts);
    if (persistence.nativeHandle) {
      addKey(provider, persistence.nativeHandle, facts);
    }
    if (provider !== "omp" || !persistence.nativeHandle?.toLowerCase().endsWith(".jsonl")) {
      return;
    }
    let walk = chainCache.get(persistence.nativeHandle);
    if (!walk) {
      walk = resolveOmpResumeAncestorPaths(persistence.nativeHandle);
      chainCache.set(persistence.nativeHandle, walk);
    }
    for (const ancestor of await walk) {
      addKey(provider, ancestor, facts);
    }
  };

  // R2-19 A-side: archivedAt is NOT an already-imported exemption. An archived
  // import is still an import (关 tab 即归档 root agent — re-listing it hands the
  // user a double-import entry and under-reports filteredAlreadyImportedCount).
  // The revive path lives in importProviderSession (restore-as-same-agent,
  // covered by its own tests) and is deliberately untouched here.
  for (const record of records) {
    await collect(record.provider, record.persistence, {
      agentId: record.id,
      archived: record.archivedAt != null,
    });
  }

  const recordById = new Map(records.map((record) => [record.id, record]));
  for (const agent of agentManager.listAgents()) {
    await collect(agent.provider, agent.persistence, {
      agentId: agent.id,
      // The record is the archive truth (archiving a loaded tab keeps the agent
      // object live); no record yet = freshly created = active.
      archived: recordById.get(agent.id)?.archivedAt != null,
    });
  }

  return { index, count: sessions.size };
}

function toProviderSessionHandleKey(provider: string, providerHandleId: string): string {
  return `${provider}\0${providerHandleId}`;
}

function isMetadataGenerationSession(input: { firstPromptPreview: string | null }): boolean {
  return (
    input.firstPromptPreview?.trimStart().startsWith(METADATA_GENERATION_PROMPT_PREFIX) ?? false
  );
}
