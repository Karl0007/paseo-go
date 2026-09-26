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
   *  directory yet — the pending visit survives to the next focus. */
  lastEventAtOf: (serverId: string, agentId: string) => number | undefined;
}

export interface ChatOpener {
  /** Mark read at the chat's press-time event stamp, remember the visit, navigate. */
  open: (target: ChatOpenTarget) => void;
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
    open(target) {
      deps.markRead(target.key, target.lastEventAt);
      pending = {
        key: target.key,
        serverId: target.serverId,
        agentId: target.agentId,
        at: target.lastEventAt,
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
