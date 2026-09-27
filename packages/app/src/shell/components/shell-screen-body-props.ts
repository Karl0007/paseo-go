/**
 * C31 shared props for the shell tab screen bodies (chats/workspace, C16 body
 * pattern). The tablet list column passes the route-derived selection
 * (DESIGN-tablet §3.2 「选中态单一真相」): the `${serverId}:${agentId}` key of the
 * session the detail column renders, or null. The compact tab screens pass nothing —
 * rows render with no selection there (§4-1: compact has no selection concept), so
 * the compact tree keeps its pre-C31 shape.
 */
export interface ShellScreenBodyProps {
  selectedAgentKey?: string | null;
}
