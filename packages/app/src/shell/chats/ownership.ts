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
  /**
   * Protocol `origin` (COMPAT(agentOrigin), B6-OWN-HEAL): the BIRTH axis — `launch`
   * (a daemon provider process created the session) or `import` (the import screen
   * adopted it). Optional on purpose: only the visible pill asks 「原生还是非原生」.
   * The send guard and the pre-open guard ask 「is a foreign writer live RIGHT NOW」,
   * a question birth never changes (D22: 发送守卫等 external 语义消费方不改), so they
   * keep passing the pair alone and their semantics stay exactly as B4 shipped them.
   */
  origin?: string | null | undefined;
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

/**
 * B5-OWNVIS (批次五 F16/D19, 用户拍板): ownership is not a warning-only axis —
 * the user must SEE who holds the session on both surfaces (列表标题后 + 会话页
 * 胶囊区), so every wire posture renders a word, never nothing.
 * B6-OWN-HEAL (批次六 F19/D22) sharpens what the third state means: `none`/absent
 * is no longer the end of the question. With no live-writer evidence the pill
 * answers from the BIRTH axis (see `ownershipPresentation`), so 未知 now survives
 * only for the case that is genuinely unknowable from here — a daemon that never
 * reported an ownership pair AND never reported a birth (pre-go.7 hosts).
 */
export type OwnershipVisibilityState = "native" | "external" | "unknown";

/** Pill color story: external keeps B4's warning tint; the two quiet states do
 *  not borrow the 已导入 grey or the four-state light (F8.6 stays honored — the
 *  word carries the state, the fill only grades loudness). */
export type OwnershipPillTone = "neutral" | "warning" | "outline";

export interface OwnershipPresentation {
  state: OwnershipVisibilityState;
  /** Shell-namespace locale key for the pill word. */
  labelKey: string;
  tone: OwnershipPillTone;
}

/** Locale keys for the two non-external states (external reuses the badge pair). */
export const OWNERSHIP_STATE_LABEL_KEY = {
  native: "chats.ownership.state.native",
  unknown: "chats.ownership.state.unknown",
} as const;

/**
 * The ONE decision the row, the capsule and the a11y labels share: the live-writer
 * axis OVERWRITES the birth axis, it does not replace it (D22).
 * 1. the watcher saw a foreign write (`external`) → 外部, B4's live-writer split;
 * 2. a daemon-owned provider process holds it (`paseo`) → 原生;
 * 3. no evidence either way — `none`/absent: idle, released, or a provider with no
 *    observable transcript → answer by BIRTH: launched here → 原生, adopted by the
 *    import screen → 外部; no birth reported at all → 未知.
 * Step 3 used to answer 未知 unconditionally, which is why every pre-B4 record read
 * 未知 forever and a daemon restart left the whole list there (the F19 report).
 */
export function ownershipPresentation(facts: OwnershipFacts): OwnershipPresentation {
  if (facts.ownership === "external") {
    const kind = ownershipBadgeKind(facts);
    return {
      state: "external",
      labelKey: OWNERSHIP_BADGE_LABEL_KEY[kind ?? "external"],
      tone: "warning",
    };
  }
  if (facts.ownership === "paseo") {
    return { state: "native", labelKey: OWNERSHIP_STATE_LABEL_KEY.native, tone: "neutral" };
  }
  if (facts.origin === "launch") {
    return { state: "native", labelKey: OWNERSHIP_STATE_LABEL_KEY.native, tone: "neutral" };
  }
  if (facts.origin === "import") {
    // The plain 外部, never 外部·运行中: nothing was observed writing. The state→tone
    // invariant holds (外部 is the one loud state) and the guard still passes — it
    // reads `ownershipBadgeKind`, which only `ownership === "external"` can light.
    return { state: "external", labelKey: OWNERSHIP_BADGE_LABEL_KEY.external, tone: "warning" };
  }
  return { state: "unknown", labelKey: OWNERSHIP_STATE_LABEL_KEY.unknown, tone: "outline" };
}

/** What a composer send against this agent should do. */
export type OwnershipSendDecision =
  /** Send straight through (not external, writer looks dead, or opencode). */
  | "pass"
  /** Standard fork-risk warning dialog. */
  | "warn"
  /** Codex's weakened dialog (the other side won't see this message). */
  | "warnWeak";

/**
 * R4 grading — the ONE table (口径: 别造第二套), shared by the composer send guard
 * and the pre-OPEN guard (B4-R4OPEN ruling 18: resume happens when the session
 * screen loads, so opening is the concurrent-spawn moment; send is the secondary
 * line). Only `external` + `externalLooksActive === true` warns (an external writer
 * nobody sees moving is exactly the safe case — entering/sending just takes the
 * session back). opencode passes; codex gets the weak body.
 */
export function decideOwnershipSendWarning(
  facts: OwnershipFacts & { provider: string },
): OwnershipSendDecision {
  if (ownershipBadgeKind(facts) !== "externalActive") return "pass";
  if (facts.provider === "opencode") return "pass";
  if (facts.provider === "codex") return "warnWeak";
  return "warn";
}

/** Locale keys for the dialog per decision (`pass` never renders). */
export const OWNERSHIP_SEND_BODY_KEY: Record<Exclude<OwnershipSendDecision, "pass">, string> = {
  warn: "chats.ownership.sendBody",
  warnWeak: "chats.ownership.sendBodyCodex",
};

/**
 * Locale keys for the pre-OPEN dialog (B4-R4OPEN 口径 1: 复用 send-guard 文案).
 * Title/cancel are the send dialog's strings verbatim (the risk sentence is the
 * same); only the confirm verb differs — 仍要打开 vs 仍要发送.
 */
export const OWNERSHIP_OPEN_DIALOG_KEYS = {
  title: "chats.ownership.sendTitle",
  confirm: "chats.ownership.openConfirm",
  cancel: "chats.ownership.sendCancel",
} as const;
