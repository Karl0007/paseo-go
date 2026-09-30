// One update-check round (M4 slice 2): baked go-line version vs the fork Releases
// feed. All deps injectable — the unit tests pin the state machine without network,
// the product path runs on globals (config.ts constants + feed.ts default URL).
import { SHELL_GO_VERSION } from "@/shell/config";
import { fetchLatestRelease, type LatestRelease } from "./feed";
import { compareGoVersions, parseGoVersion } from "./versions";

export type UpdateCheckOutcome = "upToDate" | "available" | "error";

export interface UpdateCheckResult {
  state: UpdateCheckOutcome;
  /** The bundle's own go version (三态 display: 当前). */
  current: string;
  /** Feed's newest go release when the feed answered with one (三态 display: 最新). */
  latest: string | null;
  url: string | null;
  /** Machine-readable failure class; UI copy stays in i18n. */
  reason?: "current-unparseable" | "feed-empty" | "feed-not-go-line" | "feed-failed";
}

export interface UpdateCheckDeps {
  fetchImpl?: typeof fetch;
  feedUrl?: string;
  timeoutMs?: number;
  currentVersion?: string;
}

export async function runUpdateCheck(deps: UpdateCheckDeps = {}): Promise<UpdateCheckResult> {
  const current = deps.currentVersion ?? SHELL_GO_VERSION;
  const currentVersion = parseGoVersion(current);
  if (!currentVersion) {
    return { state: "error", current, latest: null, url: null, reason: "current-unparseable" };
  }
  let release: LatestRelease | null;
  try {
    release = await fetchLatestRelease(deps);
  } catch {
    return { state: "error", current, latest: null, url: null, reason: "feed-failed" };
  }
  if (!release) {
    return { state: "error", current, latest: null, url: null, reason: "feed-empty" };
  }
  const latest = parseGoVersion(release.version);
  if (!latest) {
    return {
      state: "error",
      current,
      latest: release.version,
      url: release.url,
      reason: "feed-not-go-line",
    };
  }
  const newer = compareGoVersions(latest, currentVersion) > 0;
  return {
    state: newer ? "available" : "upToDate",
    current,
    latest: release.version,
    url: release.url,
  };
}
