// F6 + F6b (review, security lane): the preview screen's root resolves in three
// states, and the only trust anchors are things the user created themselves.
//  ① The workspace descriptor (serverId+workspaceId) wins outright — a URL-borne
//     root can be forged by any `paseogo://` deep link and must never steer a
//     resolved workspace into an arbitrary host path (the F6 priority inversion).
//  ② No descriptor (offline favorites): `workspaceRoot+path` params are still not
//     trusted on their own — F6b closed that fallback by requiring an exact match
//     against the user's own favorites snapshot: same host, equal workspaceRoot,
//     and the path is the snapshot entry itself or lives inside its directory
//     tree. The snapshot's root (and, on an exact match, its verbatim path) is
//     what the screen then reads.
//  ③ Anything else is denied: the screen shows its notFound state and issues no
//     daemon request at all.
//
// Comparison is deliberately conservative: separators unify to "/", "." and ".."
// resolve lexically (a relative path that pops past its start is refused; an
// absolute path clamps at its root/drive), and case is PRESERVED — on a
// case-insensitive host a case-variant link could only hit the very file the
// snapshot names, while on a case-sensitive host case-folding would let
// `/A/B.txt` slip past a `/a/b.txt` anchor. Containment is segment-wise, so a
// favorite `notes.txt` never admits `notes.txt.evil`, and a favorite anchor that
// normalizes away (".", "") never blesses the whole tree.
export interface PreviewFavoriteSnapshot {
  hostId: string;
  workspaceRoot: string;
  path: string;
}

export type PreviewRootDecision =
  | { kind: "descriptor"; root: string; path: string }
  | { kind: "favorite"; root: string; path: string }
  | { kind: "denied" };

export function resolvePreviewRoot(input: {
  hostId?: string | null;
  paramRoot?: string | null;
  paramPath?: string | null;
  descriptorRoot?: string | null;
  favorites?: readonly PreviewFavoriteSnapshot[] | null;
}): PreviewRootDecision {
  const descriptor = (input.descriptorRoot ?? "").trim();
  if (descriptor.length > 0) {
    return { kind: "descriptor", root: descriptor, path: (input.paramPath ?? "").trim() };
  }
  const hostId = (input.hostId ?? "").trim();
  const paramRoot = (input.paramRoot ?? "").trim();
  const paramPath = (input.paramPath ?? "").trim();
  if (!hostId || !paramRoot || !paramPath) return { kind: "denied" };
  const root = normalizeRoot(paramRoot);
  const path = normalizeTreePath(paramPath);
  if (path === null) return { kind: "denied" };
  for (const favorite of input.favorites ?? []) {
    if (favorite.hostId !== hostId) continue;
    const snapshotRoot = favorite.workspaceRoot.trim();
    if (!snapshotRoot || normalizeRoot(snapshotRoot) !== root) continue;
    const anchor = normalizeTreePath(favorite.path);
    // An anchor that normalizes away would bless the whole tree — never trust it.
    if (!anchor) continue;
    if (path === anchor) {
      return { kind: "favorite", root: snapshotRoot, path: favorite.path.trim() };
    }
    if (path.startsWith(`${anchor}/`)) {
      return { kind: "favorite", root: snapshotRoot, path };
    }
  }
  return { kind: "denied" };
}

/** Trim, unify separators, drop trailing separators ("/" keeps its root). */
function normalizeRoot(value: string): string {
  const unified = value.trim().replace(/\\/g, "/");
  const stripped = unified.replace(/\/+$/, "");
  return stripped.length > 0 ? stripped : unified;
}

/**
 * Lexical path normalization for containment checks. Returns null when a
 * relative path escapes its starting point (`../` popping past the workspace
 * root — exactly the deep-link trick this gate exists to stop).
 */
function normalizeTreePath(value: string): string | null {
  const unified = value.trim().replace(/\\/g, "/");
  const hasDrive = /^[A-Za-z]:\//.test(unified);
  const absolute = unified.startsWith("/") || hasDrive;
  const drive = hasDrive ? unified.slice(0, 2) : "";
  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) segments.pop();
      else if (!absolute) return null;
      continue;
    }
    segments.push(segment);
  }
  return absolute ? `${drive}/${segments.join("/")}` : segments.join("/");
}
