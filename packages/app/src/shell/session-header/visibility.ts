// C14 shell session header — the pure half: when the floating thin bar shows, and
// which menu rows it carries. Everything here is React-free and unit-testable.
//
// Visibility contract (card C14, DESIGN §7):
// 1. shell mode active (runtime switch wins over the env default — seam priority);
// 2. the top root-stack entry is the official host navigator (`h/[serverId]`) AND the
//    resolved pathname is an official workspace route `/h/<sid>/workspace/<wid>` —
//    the session screen the shell entered via the C4 open-intent push;
// 3. a `(shell)` entry sits BELOW that top entry: the stack carries shell provenance.
//    A session opened from the official IA (official /sessions, cold deep link,
//    shellMode=false) has no `(shell)` beneath and never shows the bar.
// 4. (component side) the official session store reports a focused agent for that
//    server — no agent tab, no bar.
//
// The agent identity itself is NOT parsed from the pathname: the official route
// consumes and clears the `?open=agent:<id>` intent, and tab switches never touch
// the URL. `sessions[serverId].focusedAgentId` (set by the official workspace
// screen on tab focus, cleared on blur) is the single live source.

import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";

/** Root-stack route names the predicate keys off (expo-router group/file names). */
export const SHELL_ROOT_ROUTE = "(shell)";
export const HOST_ROOT_ROUTE = "h/[serverId]";

export interface ShellSessionVisibilityInput {
  shellMode: boolean;
  /** Global pathname (expo-router `usePathname`), query allowed. */
  pathname: string;
  /** Root-stack route names in order, plus the focused index. */
  rootRoutes: readonly string[];
  rootIndex: number;
}

export interface ShellSessionWorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

export function resolveShellSessionWorkspace(
  input: ShellSessionVisibilityInput,
): ShellSessionWorkspaceTarget | null {
  if (!input.shellMode) return null;
  const top = input.rootRoutes[input.rootIndex];
  if (top !== HOST_ROOT_ROUTE) return null;
  if (!input.rootRoutes.slice(0, input.rootIndex).includes(SHELL_ROOT_ROUTE)) return null;
  return parseHostWorkspaceRouteFromPathname(input.pathname);
}

// ---------------------------------------------------------------------------
// Menu matrix — the header-menu sibling of chatMenuPlan (shellAgentActions):
// 查看项目文件/重命名 always act; 停止 is present-but-disabled unless a turn is
// actually abortable (running or blocked on an approval), the exact rule the
// chat rows use.
// ---------------------------------------------------------------------------

export type SessionHeaderActionId = "files" | "stop" | "rename";

export interface SessionHeaderMenuItem {
  id: SessionHeaderActionId;
  enabled: boolean;
}

export function sessionHeaderMenuPlan(state: { stoppable: boolean }): SessionHeaderMenuItem[] {
  return [
    { id: "files", enabled: true },
    { id: "stop", enabled: state.stoppable },
    { id: "rename", enabled: true },
  ];
}

// ---------------------------------------------------------------------------
// Menu dispatch — the header sibling of `createChatMenuRunner` (chat-row-menu):
// every capsule row funnels its id through this table. 重命名 is the row the menu
// never acts on itself (C33): it hands off to the injected screen opener that
// pushes the (shell)/rename screen, so this module stays React- and router-free
// and the routing is unit-testable.
// ---------------------------------------------------------------------------

export interface SessionHeaderRunnerDeps {
  openFiles: () => void;
  stop: () => void;
  openRename: () => void;
}

export function createSessionHeaderRunner(
  deps: SessionHeaderRunnerDeps,
): (id: SessionHeaderActionId) => void {
  return (id) => {
    if (id === "files") deps.openFiles();
    else if (id === "stop") deps.stop();
    else deps.openRename();
  };
}
