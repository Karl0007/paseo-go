// Paseo Go shell constants (DESIGN.md §2): shell-specific config lives only here.

/**
 * Upstream commit (getpaseo/paseo) this fork's baseline tracks; bump on merge syncs.
 * Bundle-time constant: metro inlines `EXPO_PUBLIC_PASEO_GO_UPSTREAM`, so builds
 * stamp the exact tree with `EXPO_PUBLIC_PASEO_GO_UPSTREAM=$(git rev-parse --short
 * HEAD)`; the literal is the fallback for bundles built without it.
 */
export const SHELL_UPSTREAM_REF = process.env.EXPO_PUBLIC_PASEO_GO_UPSTREAM ?? "919c737c";

/** Shell display version; bumped by release cards (C13). */
export const SHELL_VERSION = "0.3.0";

/**
 * Go-line release version (`paseo-go/VERSION` scheme `0.10.x-go.N`) this bundle was
 * built from — the update checker compares it against the fork Releases feed.
 * Release builds stamp the exact tag: fork-release.yml apk job sets
 * `EXPO_PUBLIC_PASEO_GO_VERSION=${{ needs.meta.outputs.version }}` (metro inlines
 * EXPO_PUBLIC_* at bundle time, same mechanism as `_UPSTREAM` above). The literal
 * is the fallback for unstamped bundles — bump it alongside the release ritual
 * (paseo-go BUILD.md §7) so dev builds compare against the last known good line.
 */
export const SHELL_GO_VERSION = process.env.EXPO_PUBLIC_PASEO_GO_VERSION ?? "0.10.2-go.0";

/**
 * Bundle-time default for shell mode. Metro inlines `EXPO_PUBLIC_*` vars at bundle
 * time, so `EXPO_PUBLIC_PASEO_GO_SHELL=1 npx expo start` turns the shell on without
 * a rebuild. The runtime store value (`paseoGo.settings.shellMode`) takes priority
 * once the user has toggled it — see `usePaseoGoShellActive` in stores/settings.
 */
export const SHELL_MODE_ENV_DEFAULT = process.env.EXPO_PUBLIC_PASEO_GO_SHELL === "1";
