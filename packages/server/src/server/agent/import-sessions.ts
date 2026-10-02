import nodePath from "node:path";
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
import {
  resolveOmpResumeAncestorPaths,
  sessionPathKey,
} from "./providers/omp/session-descriptor.js";
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
import { createRealpathAwarePathMatcher, looksLikeDefiniteWindowsPath } from "../../utils/path.js";

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
  /** Optional: the resume-chain walk warns when its depth cap truncates a live chain. */
  logger?: Logger;
}

export interface ListImportableProviderSessionsResult {
  entries: RecentProviderSessionDescriptorPayload[];
  filteredAlreadyImportedCount: number;
  /**
   * B8-COUNT (F24): how many in-register agents claim a provider transcript at
   * all — see `countClaimedAgents`. Window-independent by construction.
   */
  claimedTotal: number;
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
  const { request, agentManager, agentStorage, providerSnapshotManager, logger } = input;
  // B5-IMPORT2 (D20): `includeExisting` flips the already-existing verdict from
  // 「剔除」to「保留+标记」. Absent/false keeps the pre-B5 verdict RULE (existing
  // rows are filtered and counted into `filteredAlreadyImportedCount`) — but the
  // claim set itself grew in B5: resume-chain ancestors of a managed transcript
  // are filtered here too, so the false-mode row set is not byte-identical.
  const includeExisting = request.includeExisting === true;
  const limit = request.limit ?? 20;
  const sinceTimestamp = parseRecentProviderSessionsSince(request.since);
  const providerFilter = request.providers ? new Set(request.providers) : undefined;
  const importedIndex = await collectImportedProviderSessions(
    agentManager,
    agentStorage,
    providerFilter,
    logger,
  );
  const query = normalizeImportSessionQuery(request.query);
  // The backfill past filtered rows only matters when rows ARE filtered;
  // includeExisting keeps every row, so `limit` listings are enough.
  let listingLimit: number;
  if (query) {
    listingLimit = IMPORT_SESSION_SEARCH_SCAN_LIMIT;
  } else if (includeExisting) {
    listingLimit = limit;
  } else {
    // Size the backfill from the claim index, not the sessionId count: one managed
    // agent can filter more listing rows than it has session ids (omp rows are
    // keyed by transcript path, and each resume-chain ancestor filters one).
    // Over-sizing fetches a few extra rows; under-sizing starves the window.
    listingLimit = limit + importedIndex.size;
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
    const existingFacts = findExistingAgentFacts(
      importedIndex,
      session.provider,
      session.providerHandleId,
    );
    if (existingFacts) {
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
      // B8-COUNT (F24 追加口径): the descriptor's cwd is the client's display/matching
      // input (project segment, identity tile, local search haystack). Windows
      // providers spell one directory several ways, so fold it here — the handle,
      // the claim keys and the dedup key above are deliberately untouched.
      payload.cwd = normalizeProviderSessionDisplayCwd(payload.cwd);
      if (includeExisting) {
        const facts = findExistingAgentFacts(
          importedIndex,
          descriptor.provider,
          descriptor.providerHandleId,
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
    claimedTotal: countClaimedAgents(importedIndex),
    providerErrors: listing.providerErrors,
  };
}

function normalizeImportSessionQuery(query: string | undefined): string | null {
  const normalized = query?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * B8-COUNT (F24): the「共 N 个会话已是你的 agent」number.
 *
 * The claim index maps *handle spellings* to agents, so one conversation sits on
 * several keys: `persistence.sessionId`, `nativeHandle`, every omp resume-chain
 * ancestor and each ancestor's case-folded spelling. The user-facing unit is the
 * conversation, so the count dedupes to the owning agent — the same merge the
 * badges already make (`addKey` lets an active claim overwrite the archived one
 * for a shared handle, and a resume chain badges as one agent).
 *
 * It is read off the index, not the listing: the import window (limit/query/since/
 * cwd) decides which ROWS exist, never how many of the user's agents already own
 * a transcript. That is the whole F24 mismatch — 6597 transcripts, 200-row window,
 * a badge count that silently meant "the intersection".
 */
function countClaimedAgents(index: Map<string, ExistingAgentFacts>): number {
  const agents = new Set<string>();
  for (const facts of index.values()) {
    agents.add(facts.agentId);
  }
  return agents.size;
}

const WINDOWS_NAMESPACE_PREFIX = /^[/\\]{2}\?[/\\]/u;
const WINDOWS_DRIVE_PREFIX = /^([a-z]):/u;

/**
 * B8-COUNT (F24 追加口径): host-aware normalization of a provider session's cwd for
 * the display/matching half of the import descriptor.
 *
 * Windows providers spell the same directory differently per writer
 * (`c:\work\paseo-go` out of a transcript header, `C:/work/paseo-go` out of a
 * realpath). The import screen matches this string against the daemon's
 * registered project directories, so an un-normalized row misses its project and
 * falls back to the raw path's first character — the「C」vs「K」tile frame gap.
 *
 * Pure and syscall-free: `\\?\` device prefix dropped, separators folded to `/`,
 * drive letter upper-cased, `.`/`..`/duplicate separators collapsed, trailing
 * separator dropped. Anything that is not definitely a Windows path comes back
 * untouched — POSIX case is significant, folding it would merge two directories.
 */
export function normalizeProviderSessionDisplayCwd(cwd: string): string {
  const unprefixed = cwd.replace(WINDOWS_NAMESPACE_PREFIX, "");
  if (!looksLikeDefiniteWindowsPath(unprefixed)) {
    return cwd;
  }
  // `win32.normalize` folds `/`+`\`, duplicate separators and `.`/`..`, and keeps a
  // trailing separator — which a project directory is displayed and compared
  // without, unless the trailing separator IS the path (a drive/UNC root).
  const normalized = nodePath.win32.normalize(unprefixed);
  const root = nodePath.win32.parse(normalized).root;
  const trimmed =
    normalized !== root && /[\\/]$/u.test(normalized) ? normalized.slice(0, -1) : normalized;
  const slashed = trimmed.replaceAll("\\", "/");
  return slashed.replace(WINDOWS_DRIVE_PREFIX, (_match, drive: string) =>
    `${drive}:`.toUpperCase(),
  );
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
  logger: Logger | undefined,
): Promise<Map<string, ExistingAgentFacts>> {
  const index = new Map<string, ExistingAgentFacts>();
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
    addKey(provider, persistence.sessionId, facts);
    // nativeHandle is z.any() in the storage schema — a non-string is skipped,
    // not thrown through (pre-B5 code tolerated it via template-literal
    // stringification).
    const nativeHandle =
      typeof persistence.nativeHandle === "string" ? persistence.nativeHandle : null;
    if (nativeHandle) {
      addKey(provider, nativeHandle, facts);
    }
    if (provider !== "omp" || !nativeHandle?.toLowerCase().endsWith(".jsonl")) {
      return;
    }
    let walk = chainCache.get(nativeHandle);
    if (!walk) {
      // A broken chain degrades to「祖先未知」: one unreadable transcript must not
      // fail the whole listing request (the cached promise never rejects).
      walk = resolveOmpResumeAncestorPaths(nativeHandle, undefined, logger).catch(() => []);
      chainCache.set(nativeHandle, walk);
    }
    for (const ancestor of await walk) {
      addKey(provider, ancestor, facts);
      // omp wrote `parentSession` with its own spelling; scanner rows come from
      // readdir. On case-insensitive filesystems the two can differ in case only,
      // so claim the folded key too — the same normalization omp's own
      // parent-linking uses (sessionPathKey).
      addKey(provider, sessionPathKey(ancestor), facts);
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

  return index;
}

function toProviderSessionHandleKey(provider: string, providerHandleId: string): string {
  return `${provider}\0${providerHandleId}`;
}

function findExistingAgentFacts(
  index: Map<string, ExistingAgentFacts>,
  provider: string,
  providerHandleId: string,
): ExistingAgentFacts | undefined {
  const direct = index.get(toProviderSessionHandleKey(provider, providerHandleId));
  if (direct) return direct;
  if (provider !== "omp") return undefined;
  // omp handles are transcript paths; a claim written by the resume-chain walk
  // (omp's own spelling) and a scanner row (readdir spelling) can differ in case
  // only on case-insensitive filesystems.
  return index.get(toProviderSessionHandleKey(provider, sessionPathKey(providerHandleId)));
}

function isMetadataGenerationSession(input: { firstPromptPreview: string | null }): boolean {
  return (
    input.firstPromptPreview?.trimStart().startsWith(METADATA_GENERATION_PROMPT_PREFIX) ?? false
  );
}
