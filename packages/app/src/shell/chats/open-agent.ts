// C4 open wiring (DESIGN §7): tapping a chat row enters the official session through
// the official navigateToAgent tool family — workspace route + open intent — never the
// `/h/[sid]/agent/[aid]` parse stub, whose null render flashed a white frame on back
// (SPIKE A2). Read-clearing has two beats: on entry (the row must read as seen if the
// user leaves immediately) and on return (activity that happened *during* the visit was
// watched, so it must not resurface as unread). The second beat keys off a pending
// target set by `open`, so the screen's first focus and plain re-focuses clear nothing.
//
// React-free and dependency-injected like shellAgentActions, so the markRead timing is
// unit-testable without a navigator or a store.

export interface ChatOpenTarget {
  /** `${serverId}:${agentId}` — the readState/pins row key. */
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null | undefined;
}

export interface ChatOpenerDeps {
  markRead: (key: string, at: number) => void;
  /** shellNavigateToAgent: official tool family (workspace route + open intent), push verb. */
  navigateToAgent: (input: {
    serverId: string;
    agentId: string;
    workspaceId?: string | null;
  }) => unknown;
  now: () => number;
}

export interface ChatOpener {
  /** Mark read at press time, remember the visit, hand navigation to the official tool. */
  open: (target: ChatOpenTarget) => void;
  /** Wire to the screen's focus effect: clears the read stamp of the last visit. */
  onFocus: () => void;
}

export function createChatOpener(deps: ChatOpenerDeps): ChatOpener {
  let pendingKey: string | null = null;
  return {
    open(target) {
      deps.markRead(target.key, deps.now());
      pendingKey = target.key;
      deps.navigateToAgent({
        serverId: target.serverId,
        agentId: target.agentId,
        workspaceId: target.workspaceId,
      });
    },
    onFocus() {
      if (pendingKey === null) return;
      deps.markRead(pendingKey, deps.now());
      pendingKey = null;
    },
  };
}
