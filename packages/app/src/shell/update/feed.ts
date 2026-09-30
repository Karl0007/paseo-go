// Fork Releases feed probe (M4 slice 2). Endpoint decided by live probe against
// Karl0007/paseo-go (2026-09-30): our releases are created with `--prerelease`
// (fork-release.yml release job), and GitHub's `/releases/latest` EXCLUDES
// prereleases — it 404s on this repo while go.6 is out. `/releases?per_page=1`
// returns the newest release including prereleases, and the M2 design makes the
// newest release the latest-pointer (its body is the asset manifest). So: the list
// endpoint, first entry.
//
// Test hook (card: 不许硬编码假数据进产品路径): `EXPO_PUBLIC_PASEO_GO_UPDATE_FEED`
// overrides the URL at bundle time — metro inlines EXPO_PUBLIC_* exactly like
// EXPO_PUBLIC_PASEO_GO_VERSION / _SHELL / _UPSTREAM (config.ts). A dev bundle
// started with the var pointed at a local mock server exercises the banner and the
// 三态 manual check end to end; the product constant stays untouched. The feed
// shape a mock must serve is GitHub's release-list JSON (array of release objects).

export const DEFAULT_UPDATE_FEED_URL =
  "https://api.github.com/repos/Karl0007/paseo-go/releases?per_page=1";

/** GitHub is fast; a stalled probe must not hold the "checking" phase hostage. */
export const UPDATE_FEED_TIMEOUT_MS = 8_000;

export interface LatestRelease {
  /** Tag without the leading `v` (e.g. `0.10.2-go.6`). */
  version: string;
  /** Release page URL — the banner/row tap destination (下载页). */
  url: string;
}

interface GitHubReleaseLike {
  tag_name?: unknown;
  html_url?: unknown;
}

/** Bundle-time feed override; empty/absent → the fork Releases default. */
export function resolveUpdateFeedUrl(): string {
  const raw = process.env.EXPO_PUBLIC_PASEO_GO_UPDATE_FEED;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_UPDATE_FEED_URL;
}

/**
 * Resolves the newest release, or null when the feed answered fine but carries no
 * release (empty list). Transport failures (network, non-2xx, malformed body,
 * timeout) THROW — the checker maps them to the visible error state; a silent null
 * is reserved for "feed is up, nothing to point at".
 */
export async function fetchLatestRelease(
  deps: {
    fetchImpl?: typeof fetch;
    feedUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<LatestRelease | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  const feedUrl = deps.feedUrl ?? resolveUpdateFeedUrl();
  const timeoutMs = deps.timeoutMs ?? UPDATE_FEED_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(feedUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`update feed http ${response.status}`);
    const body: unknown = await response.json();
    const first: unknown = Array.isArray(body) ? body[0] : undefined;
    if (first === undefined || first === null) return null;
    if (typeof first !== "object") throw new Error("update feed release shape unexpected");
    const release = first as GitHubReleaseLike;
    if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") {
      throw new Error("update feed release shape unexpected");
    }
    return { version: release.tag_name.replace(/^v/, ""), url: release.html_url };
  } finally {
    clearTimeout(timer);
  }
}
