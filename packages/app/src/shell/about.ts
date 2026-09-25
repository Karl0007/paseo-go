// 关于卡 data assembly (DESIGN §6, card C8): the three facts the card shows,
// assembled in one pure function so the screen renders and the test asserts
// against the same source. Version/upstream come from shell/config (upstream is a
// bundle-time constant — see config.ts); the license link points at the upstream
// LICENSE file because the mixed licensing (Apache core + enterprise dir) cannot
// be summarised in one app-side label.
import { SHELL_UPSTREAM_REF, SHELL_VERSION } from "@/shell/config";

export const SHELL_LICENSE_URL = "https://github.com/getpaseo/paseo/blob/main/LICENSE";

export interface ShellAboutInfo {
  version: string;
  upstreamRef: string;
  licenseUrl: string;
}

export function buildShellAboutInfo(): ShellAboutInfo {
  return {
    version: SHELL_VERSION,
    upstreamRef: SHELL_UPSTREAM_REF,
    licenseUrl: SHELL_LICENSE_URL,
  };
}
