import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

/**
 * Paseo Go B4-OWNERSHIP (batch-4 F8, rulings 13/14): the session-ownership axis.
 *
 * Ownership answers one question — *who is allowed to write this provider session
 * right now* — and it is orthogonal to the `paseo.imported-provider-session` birth
 * label (birth history never changes; ownership flips back and forth):
 *
 * - `paseo`  — a provider process this daemon spawned holds the session.
 * - `external` — that process is gone AND the transcript was written by somebody
 *   else afterwards (transcript watcher confirmed a byte change).
 * - `none`   — the process is gone and nothing external was observed: whoever
 *   writes first wins. Also the conservative answer when the daemon has no
 *   transcript to observe at all (see `transcriptObservable`).
 *
 * Every rule below is a pure function of `AgentOwnershipFacts` so the state machine
 * is unit-testable without a filesystem, a provider process, or a socket.
 *
 * Provider semantics that shaped the rules (measured in
 * `paseo-go/RESEARCH-provider-dual-write.md`, 2026-09-30, five providers):
 *
 * | provider   | external continue while paseo lived        | consequence for ownership      |
 * | ---------- | ------------------------------------------ | ------------------------------ |
 * | omp / pi   | same-file DAG fork; resume takes last leaf | paseo re-sending reclaims the  |
 * |            | in file order (external branch dropped)    | line; external branch is lost  |
 * | claude     | same-file DAG fork; resume takes DEEPEST   | the external branch can win a  |
 * |            | branch (paseo's branch may be dropped)     | paseo resume → warn + fork     |
 * | codex      | linear append, interleaved, never forks    | no row loss; contexts diverge  |
 * | opencode   | shared SQLite DB, both writers see rows    | no per-session transcript →    |
 * |            |                                            | stays `none` by design         |
 *
 * No provider corrupts bytes; the danger is purely semantic, which is why R2-full
 * (a mutual-exclusion protocol) was closed and this lite state machine is enough.
 */

/** Wire union, pinned to the protocol schema so the two cannot drift. */
export type AgentOwnershipValue = NonNullable<AgentSnapshotPayload["ownership"]>;

/** Observable inputs the state machine is a function of. */
export interface AgentOwnershipFacts {
  /** A provider process owned by this daemon holds the session. */
  processAlive: boolean;
  /**
   * The daemon can observe this session's transcript (path resolvable for the
   * provider). False means external writes are invisible, so the state machine
   * must never conclude `external` — it reports `none` instead of lying.
   */
  transcriptObservable: boolean;
  /**
   * The transcript changed since paseo last wrote it. Sticky: set while the
   * paseo process is still alive (a dual-writer window) and consumed by the
   * transition that releases ownership, which is what makes R5's "exit with a
   * pending external change → `external`" fall out of the same rule.
   */
  externalChangeObserved: boolean;
}

/**
 * Persisted ownership state. `value`/`externalLooksActive` project onto the agent
 * directory; `baselineBytes` is the transcript size last known to contain only
 * paseo-written rows, so a daemon restart can still tell "the file grew while we
 * were down" from "nothing happened".
 */
export interface AgentOwnershipState extends AgentOwnershipFacts {
  value: AgentOwnershipValue;
  /** In `external`, does the external writer still look alive (R4 signal)? */
  externalLooksActive: boolean;
  baselineBytes: number | null;
}

export const INITIAL_AGENT_OWNERSHIP: AgentOwnershipState = {
  value: "none",
  externalLooksActive: false,
  processAlive: false,
  transcriptObservable: false,
  externalChangeObserved: false,
  baselineBytes: null,
};

/** The single derivation rule; every transition below re-derives through it. */
export function deriveAgentOwnershipValue(facts: AgentOwnershipFacts): AgentOwnershipValue {
  if (facts.processAlive) {
    return "paseo";
  }
  if (!facts.transcriptObservable) {
    return "none";
  }
  return facts.externalChangeObserved ? "external" : "none";
}

function withValue(state: AgentOwnershipState): AgentOwnershipState {
  const value = deriveAgentOwnershipValue(state);
  // `externalLooksActive` is only ever a statement about the external writer.
  return {
    ...state,
    value,
    externalLooksActive: value === "external" ? state.externalLooksActive : false,
  };
}

/**
 * R5: resume succeeded (or the session was created here) — paseo owns the session
 * again. The external-change observation is cleared: from now on every transcript
 * byte is paseo's own work, and the watcher re-baselines on the next release.
 */
export function ownershipOnAcquire(state: AgentOwnershipState): AgentOwnershipState {
  return withValue({
    ...state,
    processAlive: true,
    externalChangeObserved: false,
    externalLooksActive: false,
  });
}

/**
 * R5: the provider process exited. Falls back per rule: a pending external change
 * observed while paseo still held the session escalates to `external`, otherwise
 * the session is unclaimed (`none`).
 */
export function ownershipOnRelease(
  state: AgentOwnershipState,
  facts: { transcriptObservable: boolean; baselineBytes?: number | null },
): AgentOwnershipState {
  return withValue({
    ...state,
    processAlive: false,
    transcriptObservable: facts.transcriptObservable,
    baselineBytes: facts.baselineBytes ?? state.baselineBytes,
  });
}

/**
 * R2-lite/R3: the transcript watcher saw bytes change. While paseo still owns the
 * session this only records the pending observation (the live process is the one
 * appending, so its own writes must never escalate — the caller only feeds paseo
 * bytes it did not write). Once released, it is the `external` evidence.
 */
export function ownershipOnExternalChange(
  state: AgentOwnershipState,
  patch?: { baselineBytes?: number | null },
): AgentOwnershipState {
  return withValue({
    ...state,
    transcriptObservable: true,
    externalChangeObserved: true,
    baselineBytes: patch?.baselineBytes ?? state.baselineBytes,
  });
}

/** R2-lite: the looks-alive probe result for the external writer. */
export function ownershipWithExternalActivity(
  state: AgentOwnershipState,
  externalLooksActive: boolean,
): AgentOwnershipState {
  return withValue({ ...state, externalLooksActive });
}

/** The watcher gained or lost transcript visibility (provider/path resolution). */
export function ownershipWithTranscriptVisibility(
  state: AgentOwnershipState,
  transcriptObservable: boolean,
  baselineBytes: number | null = state.baselineBytes,
): AgentOwnershipState {
  return withValue({ ...state, transcriptObservable, baselineBytes });
}

/**
 * Rebuild the state from persisted fields after a daemon restart. Provider
 * processes are children of the daemon, so a restart always means the process is
 * gone: a persisted `paseo` is re-derived as a release, which is exactly the R5
 * fallback. `external` is the only persisted value that implies a past external
 * observation, so it is what re-seeds the sticky flag.
 */
export function restoreAgentOwnership(input: {
  ownership?: AgentOwnershipValue | null;
  externalLooksActive?: boolean | null;
  baselineBytes?: number | null;
}): AgentOwnershipState {
  const externalChangeObserved = input.ownership === "external";
  return withValue({
    value: "none",
    externalLooksActive: input.externalLooksActive === true,
    processAlive: false,
    transcriptObservable: externalChangeObserved || input.baselineBytes != null,
    externalChangeObserved,
    baselineBytes: input.baselineBytes ?? null,
  });
}
