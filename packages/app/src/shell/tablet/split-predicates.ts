// C30 tablet split — the pure half (DESIGN-tablet.md §3.2 T-A). Activation is
// `shell mode && !compact && !full-bleed`; every other state returns the children
// through untouched (§6 "竖屏零回退" — the compact tree stays byte-identical).
// React-free and unit-tested per §6 R-1 (no version-counter recomputes).

/** The three shell destinations the wide-screen nav rail carries (§3.2-1). */
export type TabletSection = "chats" | "workspace" | "me";

// Onboarding/pairing are not the IM surface — they stay full-window (§3.2).
const FULL_BLEED_ROUTES = ["/welcome", "/pair-scan"] as const;

export function isFullBleedPathname(pathname: string): boolean {
  // Query/hash stripped: `usePathname` may carry `?open=agent:…`-style suffixes.
  const path = pathname.split("?")[0].split("#")[0];
  return FULL_BLEED_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

export interface TabletSplitActivation {
  /** `useShellSeam().active` — shell mode wins over the official IA only. */
  shellActive: boolean;
  /** `useIsCompactFormFactor()` — xs/sm keep the phone tab layout (§2 matrix). */
  isCompact: boolean;
  /** `isFullBleedPathname(pathname)`. */
  fullBleed: boolean;
}

export function shouldActivateTabletSplit(activation: TabletSplitActivation): boolean {
  return activation.shellActive && !activation.isCompact && !activation.fullBleed;
}

// pathname → section (§3.2-2). The (shell) group is stripped from the global
// pathname, so tab screens read `/chats` / `/workspace` / `/me` and the hidden
// pushes add `/files/…`, `/import`, `/commands/edit`. `/h/…` (official session),
// `/import` and `/commands/edit` map to null = "keep the previous section" — the
// host remembers via ref. Exact-match on the tab paths is deliberate: the
// official session route contains `/workspace/` mid-path (`/h/<sid>/workspace/<wid>`)
// and must NOT be read as the workspace tab.
export function tabletSectionForPathname(pathname: string): TabletSection | null {
  const path = pathname.split("?")[0].split("#")[0];
  if (path === "/chats") return "chats";
  if (path === "/me") return "me";
  if (path === "/workspace") return "workspace";
  if (path === "/files" || path.startsWith("/files/")) return "workspace";
  return null;
}
