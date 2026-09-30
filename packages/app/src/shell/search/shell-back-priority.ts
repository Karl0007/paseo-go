// B4-BACK (BATCH4-ALIGNMENT F9 / 裁定 15) — the pure half of the search back
// priority: WHICH screen a hardware back press belongs to. The ruling is
// 「搜索态激活 → 退出搜索，否则才走现有页面返回」; the hook sibling subscribes
// while a search is open, but a subscription alone is NOT the whole claim —
// bottom-tabs keep visited tab bodies mounted and (detail) screens push over
// the tabs, so a background search must never swallow the front screen's back
// (chats search open → push a session → back must POP the session, not clear
// the hidden filter). The press-time answer comes from the navigation state:
// the surface claims the press only when its OWN route is the deepest focused
// route of the app stack. React-free and unit-testable, the focused-tab /
// split-predicates posture; route names come from shell/routes.ts (R2-12).
//
// The state shape is structural (NavStateLike's sibling widened with `params`):
// react-navigation's own state types are recursive generics, and the hook
// casts the container state to this at the boundary — the drill below only
// ever reads `index`/`routes`/`name`/`params`/`state`.

export interface BackPriorityRouteLike {
  name: string;
  params?: Record<string, unknown> | undefined;
  state?: BackPriorityStateLike | undefined;
}

export interface BackPriorityStateLike {
  index?: number | undefined;
  routes: readonly BackPriorityRouteLike[];
}

/** What a surface's screen looks like from the deepest focused route.
 * Every present field must match; an identity with no field claims nothing
 * (a surface that cannot name itself must not swallow backs). */
export interface ShellRouteIdentity {
  /** Exact route name — tab leaves (`"chats"`) and detail screens, including
   * the leaf a folded group route carries in params.screen (`"import"`,
   * `"files/[serverId]/[workspaceId]"`). Navigators with real nested state are
   * drilled THROUGH; their directory name (`"(shell)"`) is never matched. */
  name?: string;
  /** Route-name prefix — the parameterized files route
   * (`"files/[serverId]/[workspaceId]"` starts with `"files/"`). */
  namePrefix?: string;
  /** Every key here must equal the focused route's param of the same name —
   * which of the (possibly several, stack-duplicated) files screens is on top. */
  params?: Record<string, string>;
}

/** Follow the focused child into nested navigators until the leaf — the route
 * that actually owns the screen the user sees — and unfold a group route that
 * carries its leaf in params.screen (see below). `index` is clamped defensively
 * (a transiently out-of-range index must yield null, never a crash mid-press). */
export function deepestFocusedRoute(
  state: BackPriorityStateLike | undefined,
): BackPriorityRouteLike | null {
  if (!state || state.routes.length === 0) return null;
  const focusedOf = (s: BackPriorityStateLike): BackPriorityRouteLike =>
    s.routes[Math.min(Math.max(s.index ?? 0, 0), s.routes.length - 1)];
  let route = focusedOf(state);
  while (route.state && route.state.routes.length > 0) {
    route = focusedOf(route.state);
  }
  // Folded group (真机 probe 实锤 2026-10-01): expo-router 的 group 文件夹（以及
  // react-navigation 的 object-form 嵌套 navigate）把真实叶子折进父路由的
  // params.screen/params.params——父 state 里没有可下钻的嵌套 state。文件屏的
  // deepest 因此是 `{name:"(detail)", params:{screen:"files/[serverId]/[workspaceId]",
  // params:{…}}}`；不解折叠，frontmost 永远对不上，返回键就白丢。只折一层：
  // screen 的值已是最终路由模式名。
  const screen = route.params?.screen;
  if (typeof screen === "string") {
    const inner = route.params?.params;
    return {
      name: screen,
      params:
        typeof inner === "object" && inner !== null
          ? (inner as Record<string, unknown>)
          : undefined,
    };
  }
  return route;
}

/** Does `identity` own the front screen of the app stack (the root Stack
 * state, i.e. the `__root` route's nested state)? No state at all (container
 * ref not mounted) fails OPEN: the press falls through to the page back, the
 * pre-B4-BACK behavior, instead of being swallowed by a guess. */
export function ownsFrontmostRoute(
  state: BackPriorityStateLike | undefined,
  identity: ShellRouteIdentity,
): boolean {
  if (identity.name === undefined && identity.namePrefix === undefined && !identity.params) {
    return false;
  }
  const route = deepestFocusedRoute(state);
  if (!route) return false;
  if (identity.name !== undefined && route.name !== identity.name) return false;
  if (identity.namePrefix !== undefined && !route.name.startsWith(identity.namePrefix)) {
    return false;
  }
  if (identity.params) {
    for (const [key, value] of Object.entries(identity.params)) {
      if (route.params?.[key] !== value) return false;
    }
  }
  return true;
}
