// F3 (review): the shell layout's useNavigation resolves to the ROOT stack, so the
// focused route of `navigation.getState()` is the `(shell)` group itself — the tab
// name lives one level deeper, in the focused route's nested navigator state.
// Pure extraction so the drill-down is unit-testable without a navigator.
import type { ShellTab } from "@/shell/stores/settings";

export interface NavStateLike {
  index: number;
  routes: Array<{ name: string; state?: NavStateLike }>;
}

export function focusedShellTab(state: NavStateLike | undefined): ShellTab | null {
  const focused = state?.routes[state.index];
  const name = focused?.state?.routes[focused.state.index]?.name;
  return name === "chats" || name === "workspace" || name === "me" ? name : null;
}
