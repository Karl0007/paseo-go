// C31 selection state — the pure half (DESIGN-tablet §3.2 「选中态单一真相」/§4-1):
// the left column highlights exactly the session the right column renders, derived
// from the route, never from a selection store. A session route
// (`/h/<serverId>/workspace/<workspaceId>`, optionally with the `?open=agent:…`
// intent still on it) is the ONLY pathname that selects a chat, and the agent
// identity is the official live source `sessions[serverId].focusedAgentId` — the
// same one session-header/visibility.ts pins. Everything else — the three tabs,
// files, import, commands, full-bleed onboarding — selects nothing.
//
// The row keys both list bodies highlight against are `${serverId}:${agentId}`
// (the readState/pins key; chats rows and workspace L3 rows share it). Server ids
// arrive percent-encoded on the pathname (routes.test guards the encoding), so the
// key is assembled from the DECODED id.
//
// React-free, unit-tested per §6 R-1.
const SESSION_ROUTE = /^\/h\/([^/]+)\/workspace\/[^/?#]+/;

export function sessionServerIdForPathname(pathname: string): string | null {
  const match = SESSION_ROUTE.exec(pathname);
  if (!match) return null;
  // Hostile deep links (F6/F8 surface) can carry invalid percent escapes;
  // decodeURIComponent would throw and crash the split host's render. A segment
  // that cannot decode can never equal a real row key — pass it through raw.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The `${serverId}:${agentId}` key of the row the route selects, or null.
 * `focusedAgentId` must be that server's live focus (null/undefined = no session
 * screen has written one → nothing is selected). */
export function tabletSelectedAgentKey(
  pathname: string,
  focusedAgentId: string | null | undefined,
): string | null {
  const serverId = sessionServerIdForPathname(pathname);
  if (serverId === null || !focusedAgentId) return null;
  return `${serverId}:${focusedAgentId}`;
}
