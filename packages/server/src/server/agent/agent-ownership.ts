import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

/**
 * Paseo Go B4-OWNERSHIP (batch-4 F8, rulings 13/14): the session-ownership axis.
 *
 * Ownership answers one question — *who is allowed to write this provider session
 * right now* — and it is orthogonal to the `paseo.imported-provider-session` birth
 * label (birth history never changes; ownership flips back and forth):
 *
 * - `paseo`  — a provider process this daemon spawned holds the session.
 * - `external` — the transcript was written by somebody else afterwards (the
 *   transcript watcher confirmed a byte change) and no paseo turn is in flight
 *   to explain those bytes. B9-WATCH2 (F33): the writer outranks the holder —
 *   a live session with no turn running never writes its transcript, so fresh
 *   foreign bytes flip the pill even while the daemon's idle process still
 *   holds the session; the next acquire (turn start) re-pins `paseo`.
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
  // B9-WATCH2 (F33): `processAlive` pins `paseo` only while there is no
  // foreign-byte evidence. The manager detaches the watcher and re-acquires
  // on every turn start (`onStreamTurnStarted`), so a live process cannot be
  // the writer of bytes the watcher attributed to someone else: the user is
  // running this conversation in their terminal while the app merely holds
  // it open — the pill must say 「外部·运行中」, not 「原生」. The evidence is
  // still sticky and still consumed by the acquire/release transitions, so
  // R5's release escalation is unchanged.
  if (facts.processAlive && !facts.externalChangeObserved) {
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
 * The byte cursor goes with the observation (R4-01): a cursor taken before paseo
 * started writing would attribute paseo's own new rows to an external writer the
 * moment the failed-turn/release attach replays from it. `null` = "no usable
 * cursor; the next attach establishes the baseline at the current size", which is
 * exactly "the transcript as paseo left it".
 */
export function ownershipOnAcquire(state: AgentOwnershipState): AgentOwnershipState {
  return withValue({
    ...state,
    processAlive: true,
    externalChangeObserved: false,
    externalLooksActive: false,
    baselineBytes: null,
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
 * B4-OWNERSHIP precision: the provider transport answered the liveness question
 * directly (`AgentSession.isAlive`) instead of the manager inferring it from
 * "I still hold a session object". A dead process settles through the same R5
 * release rule — which still matters after B9-WATCH2 (F33): the escalated
 * observation carries the value, but only the death report settles the process
 * fact itself, and a crashed child reaches the manager no other way (close may
 * never come; it surfaces as `turn_failed`).
 *
 * Returns the SAME object when nothing moved, so callers can compare by identity
 * and skip a broadcast.
 */
export function ownershipWithProcessLiveness(
  state: AgentOwnershipState,
  processAlive: boolean,
): AgentOwnershipState {
  if (state.processAlive === processAlive) {
    return state;
  }
  // A process standing behind the session again is a re-claim, the same
  // transition a resume performs: from now on every transcript byte is
  // paseo's work, and stale foreign evidence must not keep the pill on
  // `external` while the daemon itself continues the conversation.
  return processAlive
    ? ownershipOnAcquire(state)
    : ownershipOnRelease(state, { transcriptObservable: state.transcriptObservable });
}

/**
 * R2-lite/R3: the transcript watcher saw bytes change. The caller only ever
 * feeds bytes paseo did not write (the manager detaches the watcher around
 * every run), so B9-WATCH2 (F33) lets the evidence escalate immediately: a
 * live session with no turn in flight never writes its transcript, and the
 * pill follows the writer. The flag stays sticky either way — consumed by
 * the next acquire, honoured by the R5 release fallback.
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
 * R4-27: an attach that could not resolve the transcript is NOT evidence that
 * the provider has no transcript — resolution fails transiently (mount not up,
 * provider dir mid-rewrite). A session whose watcher already proved something
 * (a pending external change, a persisted cursor) keeps that evidence
 * untouched; only a session that was never observed at all settles to
 * `transcriptObservable: false`.
 */
export function ownershipOnAttachFailure(state: AgentOwnershipState): AgentOwnershipState {
  if (state.externalChangeObserved || state.baselineBytes !== null) {
    return state;
  }
  return withValue({ ...state, transcriptObservable: false });
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
