// C4 open wiring (DESIGN §7): tapping a chat row enters the official session through
// the official navigateToAgent tool family — workspace route + open intent — never the
// `/h/[sid]/agent/[aid]` parse stub, whose null render flashed a white frame on back
// (SPIKE A2). Read-clearing has two beats: on entry (the row must read as seen if the
// user leaves immediately) and on return (activity that happened *during* the visit was
// watched, so it must not resurface as unread). The second beat keys off a pending
// target set by `open`, so the screen's first focus and plain re-focuses clear nothing.
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
// R2-10 (FIX-A): the dialog SUSPENDS the open. Once the user confirms, the
// entry stamp re-reads the watermark via `lastEventAtOf` — activity that
// landed while the warning was up must not be marked seen by a press-time
// snapshot nobody watched. The snapshot stays the fallback for a row the
// directory lost mid-dialog; the synchronous (non-imported / already-acked)
// path never touches the directory.

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
   *  directory yet — the pending visit survives to the next focus. */
  lastEventAtOf: (serverId: string, agentId: string) => number | undefined;
  /** C24: official confirm dialog for the fork warning; true = 继续进入. */
  confirmFork: () => Promise<boolean>;
  /** C24: has this row key already acknowledged the fork warning? */
  forkAcknowledged: (key: string) => boolean;
  /** C24: persist the acknowledgement so the warning is exactly-once per chat. */
  acknowledgeFork: (key: string) => void;
}

export interface ChatOpener {
  /** Warn-then-open: fork guard first, then mark read, remember, navigate. */
  open: (target: ChatOpenTarget) => Promise<void>;
  /** Wire to the screen's focus effect: clears the read stamp of the last visit. */
  onFocus: () => void;
}

interface PendingVisit {
  key: string;
  serverId: string;
  agentId: string;
  /** Entry watermark; the return stamp never drops below it (host clock can step). */
  at: number;
}

export function createChatOpener(deps: ChatOpenerDeps): ChatOpener {
  let pending: PendingVisit | null = null;
  return {
    async open(target) {
      // R2-10: the stamp target starts at the press snapshot and is re-taken
      // below only when the fork gate actually suspends the open.
      let at = target.lastEventAt;

      // C24: the gate runs BEFORE the read stamp — a cancelled open never entered
      // the session, so the row must stay unread. Non-imported rows short-circuit
      // synchronously (the pre-C24 open path is unchanged for them).
      if (target.imported && !deps.forkAcknowledged(target.key)) {
        const proceed = await deps.confirmFork();
        if (!proceed) return;
        deps.acknowledgeFork(target.key);
        // The only await on the open path — re-take the watermark after it;
        // undefined (row gone) falls back to the press snapshot.
        at = deps.lastEventAtOf(target.serverId, target.agentId) ?? target.lastEventAt;
      }
      deps.markRead(target.key, at);
      pending = {
        key: target.key,
        serverId: target.serverId,
        agentId: target.agentId,
        at,
      };
      deps.navigateToAgent({
        serverId: target.serverId,
        agentId: target.agentId,
        workspaceId: target.workspaceId,
      });
    },
    onFocus() {
      if (pending === null) return;
      const visit = pending;
      const fresh = deps.lastEventAtOf(visit.serverId, visit.agentId);
      if (fresh === undefined) return;
      pending = null;
      deps.markRead(visit.key, Math.max(fresh, visit.at));
    },
  };
}
