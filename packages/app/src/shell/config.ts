// Paseo Go shell constants (DESIGN.md §2): shell-specific config lives only here.

/** Upstream commit (getpaseo/paseo) this fork's baseline tracks; bump on merge syncs. */
export const SHELL_UPSTREAM_REF = "db4fd334";

/** Shell display version; bumped by release cards (C13). */
export const SHELL_VERSION = "0.1.0";

/**
 * Bundle-time default for shell mode. Metro inlines `EXPO_PUBLIC_*` vars at bundle
 * time, so `EXPO_PUBLIC_PASEO_GO_SHELL=1 npx expo start` turns the shell on without
 * a rebuild. The runtime store value (`paseoGo.settings.shellMode`) takes priority
 * once the user has toggled it — see `usePaseoGoShellActive` in stores/settings.
 */
export const SHELL_MODE_ENV_DEFAULT = process.env.EXPO_PUBLIC_PASEO_GO_SHELL === "1";
