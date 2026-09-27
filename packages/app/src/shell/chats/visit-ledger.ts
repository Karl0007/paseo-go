// R2-02/R2-03 (FIX-B): the C18 双拍's second beat moves out of the opener's
// closure into this module-level ledger. As a closure it was one-per-body-
// instance, and four chains lost the beat (review2 CONFIRMED): a body remount
// (wide↔compact flip, section switch) handed the screen a fresh opener with an
// empty pending; opening B overwrote A's single slot; the notification tap and
// the quick-command run recorded no visit at all. And on wide the settlement
// rode the next focus of the tab screen — indefinitely deferrable, so whatever
// the chat did while the user was away got stamped as seen on that late beat
// (R2-03: silent read).
//
// Posture = the section-focus / rail-events pure bus: React-free, no store
// imports. The watermark clock and the read stamp arrive via
// `registerVisitLedgerDeps`, which every `createChatOpener` wires (the bodies
// own both ports; last registration wins — the closures are equivalent).
//
// Settlement = the LEAVE moment (ruling 1a): the rail section switch calls
// `settleVisits` before navigating, `recordVisit` settles the previous slots
// first (switching sessions IS the leave action for the earlier visit), and the
// section-focus beat is kept as compensation — it only ever finds slots the
// leave hooks could not reach (e.g. the directory row was not loaded yet).
// Watermark rule: a settle stamps `lastEventAtOf` AT THE SETTLE MOMENT, floored
// at the slot's entry stamp (the host clock can step back). `undefined` from
// the clock = the row is absent / its dates are garbage (R2-14 maps null to
// undefined) — the slot survives, nothing bogus is stamped, the visit is not
// lost. Multi-slot keyed by the row key: B can no longer overwrite A.
import type { ShellTab } from "@/shell/stores/settings";

/** One entered session awaiting its return stamp. */
export interface VisitSlot {
  /** Which list recorded the visit (diagnostics/attribution; settlement is global —
   *  the session screen is shared, so any leave event ends every visit). */
  section: ShellTab;
  /** `${serverId}:${agentId}` — the readState row key (server ids may contain ':'). */
  key: string;
  serverId: string;
  agentId: string;
  /** Entry watermark (host domain); the settle stamp never drops below it. */
  at: number;
}

export interface VisitLedgerDeps {
  /** Fresh host-domain last-event stamp; undefined = no trustworthy stamp right
   *  now (row not in the directory / R2-14 garbage dates) → the slot survives. */
  lastEventAtOf: (serverId: string, agentId: string) => number | undefined;
  markRead: (key: string, at: number) => void;
}

export type VisitSettleReason = "section-switch" | "re-record" | "focus-return";

const visits = new Map<string, VisitSlot>();
let deps: VisitLedgerDeps | null = null;

/** Wire the settlement ports. Called by every createChatOpener; idempotent. */
export function registerVisitLedgerDeps(next: VisitLedgerDeps): void {
  deps = next;
}

/** Enter a session: settle the visits the earlier slots still hold (the switch
 *  is their leave moment), then record this one. */
export function recordVisit(slot: VisitSlot): void {
  settleVisits("re-record");
  visits.set(slot.key, slot);
}

/** Leave moment: drain every slot with the watermark read NOW. Returns the
 *  settled row keys. A slot whose clock is undefined survives untouched. */
export function settleVisits(reason: VisitSettleReason): readonly string[] {
  if (deps === null) {
    // A stranded settle means a visit exists but nothing can stamp it — the
    // wiring is broken (a body must have mounted before any leave event).
    if (visits.size > 0) {
      console.warn("[visit-ledger] settle without deps: visit slots stranded", {
        reason,
        stranded: visits.size,
      });
    }
    return [];
  }
  const { lastEventAtOf, markRead } = deps;
  const settled: string[] = [];
  // Live Map iteration: deleting the CURRENT entry is spec-safe (deleted entries
  // are skipped), which also makes a re-entrant settle double-drain-proof.
  for (const slot of visits.values()) {
    const fresh = lastEventAtOf(slot.serverId, slot.agentId);
    if (fresh === undefined) continue;
    visits.delete(slot.key);
    markRead(slot.key, Math.max(fresh, slot.at));
    settled.push(slot.key);
  }
  return settled;
}

/** The pending slots (test/diagnostic seam; treat as read-only). */
export function pendingVisits(): readonly VisitSlot[] {
  return [...visits.values()];
}

/** Test seam: the ledger is process-global like the section bus. */
export function resetVisitLedger(): void {
  visits.clear();
  deps = null;
}
