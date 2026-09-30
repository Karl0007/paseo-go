// Ownership presentation model (B4-OWNERSHIP-UI, batch-4 F8 ruling 14): what the
// shell shows and warns for each value of the protocol `ownership` axis. Pure
// strings-in/decisions-out — the badge component and the send guard both read these
// rules, and the unit tests pin them without React Native.
//
// Wire posture (protocol COMPAT(agentOwnership)): `ownership` is optional-nullable;
// consumers MUST read `undefined`/`null` as `none`, and `externalLooksActive` as
// `false`. So every rule below treats a missing pair exactly like a pre-go.7 daemon:
// no badge, no warning.
//
// The R4 grading table lives in RESEARCH-provider-dual-write.md (结论 2, Main 采纳
// 2026-09-30). This batch ships the UNIFIED warning dialog for every graded provider
// (fork-on-send for claude is a tail card); the per-provider difference is the TEXT:
// - opencode: shared SQLite DB — both writers see each other, the dialog is pure
//   noise → pass (no dialog).
// - codex: linear rollout log — nothing is lost, but the other process's in-memory
//   context never sees this message → weakened body text.
// - claude / omp / pi (and any future provider with an observable transcript):
//   live-writer branch fork/loss semantics → standard body text.

/** The two badge variants; `null` (returned by `ownershipBadgeKind`) = no badge. */
export type OwnershipBadgeKind = "external" | "externalActive";

export interface OwnershipFacts {
  /** Protocol `ownership`; `undefined`/`null` read as `none`. */
  ownership: string | null | undefined;
  /** Protocol `externalLooksActive`; `undefined`/`null` read as `false`. */
  externalLooksActive: boolean | null | undefined;
}

/**
 * The 「外部」 badge: external-only (paseo/none wear no badge, ruling 14's
 * three-state distinguishability), with the 「外部·运行中」 variant when the
 * external writer still looks alive.
 */
export function ownershipBadgeKind(facts: OwnershipFacts): OwnershipBadgeKind | null {
  if (facts.ownership !== "external") return null;
  return facts.externalLooksActive === true ? "externalActive" : "external";
}

/** Locale keys for the two badge variants (shell namespace). */
export const OWNERSHIP_BADGE_LABEL_KEY: Record<OwnershipBadgeKind, string> = {
  external: "chats.ownership.badge",
  externalActive: "chats.ownership.badgeActive",
};

/** What a composer send against this agent should do. */
export type OwnershipSendDecision =
  /** Send straight through (not external, writer looks dead, or opencode). */
  | "pass"
  /** Standard fork-risk warning dialog. */
  | "warn"
  /** Codex's weakened dialog (the other side won't see this message). */
  | "warnWeak";

/**
 * R4 send-warning grading. Only `external` + `externalLooksActive === true` warns
 * (an external writer nobody sees moving is exactly the safe case — sending just
 * takes the session back). opencode passes; codex gets the weak body.
 */
export function decideOwnershipSendWarning(
  facts: OwnershipFacts & { provider: string },
): OwnershipSendDecision {
  if (ownershipBadgeKind(facts) !== "externalActive") return "pass";
  if (facts.provider === "opencode") return "pass";
  if (facts.provider === "codex") return "warnWeak";
  return "warn";
}

/** Locale keys for the dialog copy per decision (`pass` never renders). */
export const OWNERSHIP_SEND_BODY_KEY: Record<Exclude<OwnershipSendDecision, "pass">, string> = {
  warn: "chats.ownership.sendBody",
  warnWeak: "chats.ownership.sendBodyCodex",
};
