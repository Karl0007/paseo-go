// C14 shell session header — the pure half: when the floating bar shows, and
// which menu rows it carries. Everything here is React-free and unit-testable.
//
// Visibility contract (card C14, DESIGN §7; C21 top-replacement + explorer yield):
// 1. shell mode active (runtime switch wins over the env default — seam priority);
// 2. the top root-stack entry is the official host navigator (`h/[serverId]`) AND the
//    resolved pathname is an official workspace route `/h/<sid>/workspace/<wid>` —
//    the session screen the shell entered via the C4 open-intent push;
// 3. a `(shell)` entry sits BELOW that top entry: the stack carries shell provenance.
//    A session opened from the official IA (official /sessions, cold deep link,
//    shellMode=false) has no `(shell)` beneath and never shows the bar.
// 4. (component side) the official session store reports a focused agent for that
//    server — no agent tab, no bar.
// 5. (C21) the compact explorer overlay is NOT open: the overlay paints its own
//    top rail (tabs + close) exactly under the capsule band, so the capsule yields
//    while the explorer owns the top. Wide layouts open the Explorer as a pane
//    instead — `mobilePanel.target` never leaves "agent" there, so the wide-form
//    capsule (C32) is untouched by this input.
// 6. (C32 裁定 2) `isCompact` is part of the input but does NOT gate the capsule:
//    wide keeps it — it IS the detail-column header (DESIGN-tablet §3.2). It is
//    the edge-back band's only gate; see `shouldEnableShellEdgeBack`.
//
// The agent identity itself is NOT parsed from the pathname: the official route
// consumes and clears the `?open=agent:<id>` intent, and tab switches never touch
// the URL. `sessions[serverId].focusedAgentId` (set by the official workspace
// screen on tab focus, cleared on blur) is the single live source.

import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { HOST_ROOT_ROUTE, SHELL_ROOT_ROUTE } from "@/shell/routes";

// The root-stack route names the predicate keys off live in shell/routes.ts
// (R2-12 single source; routes.test.ts pairs them against the src/app tree).

export interface ShellSessionVisibilityInput {
  shellMode: boolean;
  /** Global pathname (expo-router `usePathname`), query allowed. */
  pathname: string;
  /** Root-stack route names in order, plus the focused index. */
  rootRoutes: readonly string[];
  rootIndex: number;
  /** C21: compact explorer overlay open ⇒ the capsule yields its top band. */
  explorerOverlayOpen?: boolean;
  /**
   * C32: window is compact (xs/sm, per shell/tablet/form-factor). Capsule
   * visibility is breakpoint-INDEPENDENT (wide keeps the capsule); the input
   * exists for `shouldEnableShellEdgeBack`, which is the compact-only half.
   */
  isCompact: boolean;
}

export interface ShellSessionWorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

export function resolveShellSessionWorkspace(
  input: ShellSessionVisibilityInput,
): ShellSessionWorkspaceTarget | null {
  if (!input.shellMode) return null;
  if (input.explorerOverlayOpen) return null;
  const top = input.rootRoutes[input.rootIndex];
  if (top !== HOST_ROOT_ROUTE) return null;
  if (!input.rootRoutes.slice(0, input.rootIndex).includes(SHELL_ROOT_ROUTE)) return null;
  return parseHostWorkspaceRouteFromPathname(input.pathname);
}

// C32 裁定 2 (DESIGN-tablet §3.2): the transparent left-edge right-swipe band is
// compact-only. In the wide split the session lives in the right column and its
// pop is carried by hardware back and the capsule's visible 返回 key — an edge
// band at the window's left edge would sit over the LIST column, where swiping
// must never pop the session. Same input set as the capsule predicate so the
// two can never disagree about "is the capsule up".
export function shouldEnableShellEdgeBack(input: ShellSessionVisibilityInput): boolean {
  return resolveShellSessionWorkspace(input) !== null && input.isCompact;
}

// ---------------------------------------------------------------------------
// Menu matrix — the header-menu sibling of chatMenuPlan (shellAgentActions).
// C21 aggregates the official compact-header right cluster (workspace-screen
// headerRight + WorkspaceHeaderMenuMobile) into the capsule's ⋯: the session
// actions ride shellAgentActions, the workspace views ride the official
// openExplorerSidebarView path, and 运行脚本 is a subpage whose rows fire the
// same client RPCs as WorkspaceScriptsButton (startWorkspaceScript/killTerminal).
// Gating rules (all present-but-disabled when unmet, the 停止 precedent):
//   查看项目文件 always (the C16 stack push resolves ids only);
//   查看 diff needs a git checkout with a known directory (no changes tab else);
//   打开文件浏览器 (explorer overlay, R2-16 wording) needs the checkout directory
//   (openExplorerSidebarView no-ops without);
//   刷新 (C24) is imported-ONLY — a hidden row, not present-but-disabled.
// ---------------------------------------------------------------------------

export type SessionHeaderActionId =
  | "files"
  | "diff"
  | "explorer"
  | "scripts"
  | "stop"
  | "rename"
  | "refresh";

/** Rows the runner acts on. 运行脚本 is a subpage trigger, never a dispatch. */
export type SessionHeaderActionableId = Exclude<SessionHeaderActionId, "scripts">;

export interface SessionHeaderMenuItem {
  id: SessionHeaderActionId;
  enabled: boolean;
}

export interface SessionHeaderMenuState {
  stoppable: boolean;
  hasScripts: boolean;
  isGit: boolean;
  hasCheckout: boolean;
  /** C24: `paseo.imported-provider-session` → the plan carries 刷新. */
  imported: boolean;
}

export function sessionHeaderMenuPlan(state: SessionHeaderMenuState): SessionHeaderMenuItem[] {
  return [
    { id: "files", enabled: true },
    { id: "diff", enabled: state.isGit && state.hasCheckout },
    { id: "explorer", enabled: state.hasCheckout },
    { id: "scripts", enabled: state.hasScripts },
    { id: "stop", enabled: state.stoppable },
    { id: "rename", enabled: true },
    // C24: appended last, imported-only; every existing row keeps its exact value.
    ...(state.imported ? [{ id: "refresh", enabled: true } as const] : []),
  ];
}

// ---------------------------------------------------------------------------
// Menu dispatch — the header sibling of `createChatMenuRunner` (chat-row-menu):
// every actionable capsule row funnels its id through this table. 重命名 is the
// row the menu never acts on itself (C33): it hands off to the injected screen
// opener that pushes the (shell)/rename screen, so this module stays React- and
// router-free and the routing is unit-testable. The 查看 diff / 打开文件浏览器 rows
// hand off to the injected `openExplorerSidebarView` wrappers (C21) for the same
// reason: the official opener is a store action, but the guard order and the
// no-op-on-missing-checkout behaviour stay observable from here.
// ---------------------------------------------------------------------------

export interface SessionHeaderRunnerDeps {
  openFiles: () => void;
  openDiff: () => void;
  openExplorer: () => void;
  stop: () => void;
  openRename: () => void;
  refresh: () => void;
}

export function createSessionHeaderRunner(
  deps: SessionHeaderRunnerDeps,
): (id: SessionHeaderActionableId) => void {
  return (id) => {
    if (id === "files") deps.openFiles();
    else if (id === "diff") deps.openDiff();
    else if (id === "explorer") deps.openExplorer();
    else if (id === "stop") deps.stop();
    else if (id === "refresh") deps.refresh();
    else deps.openRename();
  };
}
