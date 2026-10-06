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
// F37 (批次十, 用户拍板 2026-10-06): BOTH open-time gates are GONE. The C24
// fork dialog and the B4-R4OPEN graded confirm rested on "opening the official
// session screen resumes the agent" — falsified in production (an app-opened
// session's journal carries no daemon mount row; the C24 card itself ruled
// 只读+刷新永不分叉). Opening is read-only browsing; the composer send guard
// (shell/composer/ownership-send-guard.ts) is the ONE warning point, exactly
// where the fork actually happens. Imported chats now auto-refresh on open
// (shell-session-header host), so browsing shows the PC's latest work.
//
// R2-10 (FIX-A) watermark re-taking survives ONLY as the ledger's concern:
// the open is synchronous again, so the press snapshot is the entry stamp.
//
// R2-02 (FIX-B): the pending second beat is NO LONGER closure state — it lives
// on the module visit ledger (multi-slot, survives body remounts, never
// overwritten by the next open). This factory only records the visit on entry
// and registers the settlement ports; settlement itself happens at the leave
// moments (rail section switch / next recordVisit / focus beat as compensation).

import type { ShellTab } from "@/shell/stores/settings";
import { recordVisit, registerVisitLedgerDeps, settleVisits } from "./visit-ledger";

export interface ChatOpenTarget {
  /** `${serverId}:${agentId}` — the readState/pins row key. */
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null | undefined;
  /** Host-domain last-event stamp (chatLastEventAt) at press time. */
  lastEventAt: number;
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
  /** R2-02: which list recorded the visit (ledger attribution). */
  section: ShellTab;
}

export interface ChatOpener {
  /** Mark read, record the visit, navigate (F37: no open-time gates). */
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
      // F37: synchronous again — no dialog can suspend the open, so the press
      // snapshot IS the entry stamp.
      const at = target.lastEventAt;
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
