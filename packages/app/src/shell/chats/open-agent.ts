// C4 open wiring (DESIGN §7): tapping a chat row enters the official session through
// the official navigateToAgent tool family — workspace route + open intent — never the
// `/h/[sid]/agent/[aid]` parse stub, whose null render flashed a white frame on back
// (SPIKE A2). Read-clearing has two beats: on entry (the row must read as seen if the
// user leaves immediately) and on return (activity that happened *during* the visit was
// watched, so it must not resurface as unread). The second beat keys off the
// visit `open` records (R2-02: a module ledger, not closure state), so a screen's
// first focus and plain re-focuses clear nothing unless a visit is still unsettled.
//
// F4 (review): the watermark lives in the chat's own clock domain. markRead used to
// stamp with the device wall clock while isChatUnread compares host-issued event
// stamps — a host behind the device read as permanently seen (and one ahead as
// permanently unread). Both beats now stamp with the chat's last-event time.
//
// C18 kept that max-stamp even after unread went attention-only: a completed chat has
// attention == last-event, so watermark ≥ attention clears it on entry/return, while
// mid-run activity growth can never re-arm the (attention-gated) unread flag either.
//
// React-free and dependency-injected like shellAgentActions, so the markRead timing is
// unit-testable without a navigator or a store.
//
// C24 fork guard (DESIGN §14.10): an imported provider session keeps pointing at the
// source transcript — if that session still runs on the PC, continuing from the app
// forks it. The FIRST open of a stamped (and not yet acknowledged) chat therefore
// awaits an injected confirmation (the screen wires the official confirm dialog):
// confirm = acknowledge once (persisted store) and enter, cancel = stay on the list
// with nothing marked read. No "is the source really active" heuristic — there is no
// reliable signal (card ruling); the warning is the honest, one-time gate.
//
// B4-R4OPEN (裁定 18) moves the R4 check to the OPEN moment: the session screen's
// official resume IS the concurrent-spawn risk, so a row whose agent reads
// external + looks-active now passes the graded confirm (same table, same dialog
// copy as the composer send guard — ownership.ts) before anything is stamped or
// navigated. The send guard stays as the secondary line (e.g. a row that is still
// external after a failed resume).
//
// R2-10 (FIX-A): the dialog SUSPENDS the open. Once the user confirms, the
// entry stamp re-reads the watermark via `lastEventAtOf` — activity that
// landed while the warning was up must not be marked seen by a press-time
// snapshot nobody watched. The snapshot stays the fallback for a row the
// directory lost mid-dialog; the synchronous (non-imported / already-acked)
// path never touches the directory.
//
// R2-02 (FIX-B): the pending second beat is NO LONGER closure state — it lives
// on the module visit ledger (multi-slot, survives body remounts, never
// overwritten by the next open). This factory only records the visit on entry
// and registers the settlement ports; settlement itself happens at the leave
// moments (rail section switch / next recordVisit / focus beat as compensation).

import type { ShellTab } from "@/shell/stores/settings";
import { decideOwnershipSendWarning, type OwnershipSendDecision } from "./ownership";
import { recordVisit, registerVisitLedgerDeps, settleVisits } from "./visit-ledger";

export interface ChatOpenTarget {
  /** `${serverId}:${agentId}` — the readState/pins row key. */
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null | undefined;
  /** Host-domain last-event stamp (chatLastEventAt) at press time. */
  lastEventAt: number;
  /** C24: the agent carries `paseo.imported-provider-session` (C22 stamp). */
  imported: boolean;
  /** B4-R4OPEN (裁定 18): the row agent's ownership facts, COMPAT read
   * (`undefined`/`null` = none/false). The pre-open guard grades them with the
   * same R4 table as the send guard — never a second copy of the rules. */
  ownership: string | null | undefined;
  externalLooksActive: boolean | null | undefined;
  provider: string;
}

export interface ChatOpenerDeps {
  markRead: (key: string, at: number) => void;
  /** shellNavigateToAgent: official tool family (workspace route + open intent), push verb. */
  navigateToAgent: (input: {
    serverId: string;
    agentId: string;
    workspaceId?: string | null;
  }) => unknown;
  /** Fresh host-domain last-event stamp; undefined = the agent is not in the
   *  directory yet — the ledger slot survives to the next settle. */
  lastEventAtOf: (serverId: string, agentId: string) => number | undefined;
  /** C24: official confirm dialog for the fork warning; true = 继续进入. */
  confirmFork: () => Promise<boolean>;
  /** C24: has this row key already acknowledged the fork warning? */
  forkAcknowledged: (key: string) => boolean;
  /** C24: persist the acknowledgement so the warning is exactly-once per chat. */
  acknowledgeFork: (key: string) => void;
  /** B4-R4OPEN: official confirm dialog for the external-writer warning;
   * true = 仍要打开. Called ONLY when the R4 table says warn/warnWeak. */
  confirmOwnership: (decision: Exclude<OwnershipSendDecision, "pass">) => Promise<boolean>;
  /** R2-02: which list recorded the visit (ledger attribution). */
  section: ShellTab;
}

export interface ChatOpener {
  /** Warn-then-open: R4 open guard, then the fork guard, then mark read,
   * record the visit, navigate. A cancelled gate opens nothing. */
  open: (target: ChatOpenTarget) => Promise<void>;
  /** Wire to the screen's focus effect: compensation settle for ledger slots the
   *  leave hooks could not reach (R2-03 — leave moments settle eagerly). */
  onFocus: () => void;
}

export function createChatOpener(deps: ChatOpenerDeps): ChatOpener {
  // The ledger settles from places this factory cannot reach (the rail's
  // section switch, another screen's open); register the ports so those
  // settles read the directory and stamp through the SAME pair of closures.
  registerVisitLedgerDeps({ lastEventAtOf: deps.lastEventAtOf, markRead: deps.markRead });
  return {
    async open(target) {
      // R2-10: the stamp target starts at the press snapshot and is re-taken
      // below only when a gate actually suspends the open.
      let at = target.lastEventAt;

      // B4-R4OPEN (裁定 18): the dangerous moment is the OPEN itself — the
      // official session screen resumes the agent on load, and a resume against
      // a live external writer is the concurrent spawn. The same graded table
      // as the send guard decides: cancel = the row stays on the list (no stamp,
      // no visit, no navigation); confirm = today's path verbatim. Runs BEFORE
      // the fork gate so a cancelled check never burns the persistent fork ack.
      const r4 = decideOwnershipSendWarning({
        ownership: target.ownership,
        externalLooksActive: target.externalLooksActive,
        provider: target.provider,
      });
      if (r4 !== "pass") {
        if (!(await deps.confirmOwnership(r4))) return;
        // R2-10 again: the dialog suspended the open — re-take the watermark.
        at = deps.lastEventAtOf(target.serverId, target.agentId) ?? target.lastEventAt;
      }

      // C24: same discipline as the R4 gate — BEFORE the read stamp, a cancelled
      // open never entered the session. Rows the R4 gate passed synchronously
      // (and non-imported rows) keep the pre-C24 open path unchanged.
      if (target.imported && !deps.forkAcknowledged(target.key)) {
        const proceed = await deps.confirmFork();
        if (!proceed) return;
        deps.acknowledgeFork(target.key);
        // The gate's await suspends the open too — re-take the watermark after it
        // (same rule as the R4 gate); undefined (row gone) keeps the press snapshot.
        at = deps.lastEventAtOf(target.serverId, target.agentId) ?? target.lastEventAt;
      }
      deps.markRead(target.key, at);
      // First beat done; the second beat is the ledger's now (R2-02). Recording
      // settles any earlier visit first — on wide the detail swap A→B IS the
      // leave action for A.
      recordVisit({
        section: deps.section,
        key: target.key,
        serverId: target.serverId,
        agentId: target.agentId,
        at,
      });
      deps.navigateToAgent({
        serverId: target.serverId,
        agentId: target.agentId,
        workspaceId: target.workspaceId,
      });
    },
    onFocus() {
      // C31 双拍 return beat, re-scoped by R2-03 to a COMPENSATION settle: the
      // eager leave hooks normally drain the ledger first, so this normally
      // clears nothing. It remains for slots a leave hook could not settle
      // (directory row absent at the leave moment).
      settleVisits("focus-return");
    },
  };
}
