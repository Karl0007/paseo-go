import type { WorkspaceDescriptor } from "@/stores/session-store";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeWorkspaceOpaqueId(value: string | null | undefined): string | null {
  return trimNonEmpty(value);
}

/**
 * Identity normalizer for workspace directories. Separators unify to "/", trailing
 * separators drop. R2-09: a definite Windows shape additionally folds its
 * case-insensitive LOCATOR segments — the drive letter and the UNC server+share —
 * so `C:\x` and `c:/x` are one identity (the daemon hands the same checkout over
 * as both shapes). Every other segment stays byte-identical: this value doubles as
 * the display path, and case-folding the whole string would merge genuinely
 * different directories on case-sensitive hosts.
 *
 * Truth source = `packages/server/src/utils/path.ts` (`looksLikeDefiniteWindowsPath`
 * decides the shape, `normalizePathForComparison` folds when comparing as
 * Windows). The server folds fully because its folds are per-comparison and it
 * keeps a display twin (`normalizePathPreservingCase`); this single-value identity
 * folds locators only. The shape patterns below MUST stay identical to the server's.
 */
export function normalizeWorkspacePath(value: string | null | undefined): string | null {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) {
    return null;
  }
  if (looksLikeDefiniteWindowsPath(trimmed)) {
    return normalizeWindowsWorkspacePath(trimmed);
  }
  const withUnixSeparators = trimmed.replace(/\\/g, "/");
  if (withUnixSeparators === "/") {
    return withUnixSeparators;
  }
  const withoutTrailingSlash = withUnixSeparators.replace(/\/+$/, "");
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : "/";
}

// Mirror of server utils/path.ts looksLikeDefiniteWindowsPath (drive letter,
// `\\?\` device namespace, or UNC) — same rule, same shape, do not diverge.
function looksLikeDefiniteWindowsPath(value: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/u.test(value) ||
    /^[/\\]{2}\?[/\\]/u.test(value) ||
    /^\\{2}[^/\\]+[/\\][^/\\]+/u.test(value)
  );
}

function normalizeWindowsWorkspacePath(value: string): string {
  // `\\?\C:\x` → `C:\x`; `\\?\UNC\server\share\x` → `\\server\share\x`
  // (server stripWindowsNamespacePrefix).
  const driveNamespace = value.match(/^[/\\]{2}\?[/\\]([a-zA-Z]:)[/\\](.*)$/u);
  const uncNamespace = value.match(
    /^[/\\]{2}\?[/\\]UNC[/\\]([^/\\]+)[\\/]([^/\\]+)(?:[/\\](.*))?$/iu,
  );
  let stripped = value;
  if (driveNamespace?.[1]) {
    stripped = `${driveNamespace[1]}\\${driveNamespace[2] ?? ""}`;
  } else if (uncNamespace?.[1] && uncNamespace[2]) {
    const rest = uncNamespace[3];
    stripped = `\\\\${uncNamespace[1]}\\${uncNamespace[2]}${rest !== undefined ? `\\${rest}` : ""}`;
  }

  // Fold the locator segment only: `C:` → `c:`, `\\SRV\Share` → `\\srv\share`.
  const drive = stripped.match(/^([a-zA-Z]):([\\/].*)$/u);
  const unc = stripped.match(/^\\{2}([^/\\]+)[\\/]([^/\\]+)(.*)$/u);
  let folded = stripped;
  if (drive?.[1]) {
    folded = `${drive[1].toLowerCase()}:${drive[2]}`;
  } else if (unc?.[1] && unc[2]) {
    folded = `\\\\${unc[1].toLowerCase()}\\${unc[2].toLowerCase()}${unc[3]}`;
  }

  const withUnixSeparators = folded.replace(/\\/g, "/");
  const withoutTrailing = withUnixSeparators.replace(/\/+$/, "");
  // Drive roots keep their slash (`C:\` ≡ `c:/`, never bare `c:` — the server's
  // stripTrailingSeparators likewise preserves the parsed root).
  if (/^[a-z]:$/u.test(withoutTrailing)) {
    return `${withoutTrailing}/`;
  }
  if (withoutTrailing.length > 0) {
    return withoutTrailing;
  }
  return withUnixSeparators.startsWith("/") ? "/" : withUnixSeparators;
}

export function resolveWorkspaceRouteId(input: {
  routeWorkspaceId: string | null | undefined;
}): string | null {
  return normalizeWorkspaceOpaqueId(input.routeWorkspaceId);
}

export function resolveWorkspaceMapKeyByIdentity(input: {
  workspaces: Map<string, WorkspaceDescriptor> | null | undefined;
  workspaceId: string | null | undefined;
}): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!normalizedWorkspaceId) {
    return null;
  }

  const workspaces = input.workspaces;
  if (!workspaces) {
    return null;
  }

  if (workspaces.has(normalizedWorkspaceId)) {
    return normalizedWorkspaceId;
  }

  for (const [workspaceKey, workspace] of workspaces) {
    if (normalizeWorkspaceOpaqueId(workspace.id) === normalizedWorkspaceId) {
      return workspaceKey;
    }
  }

  return null;
}
