// Pure `0.10.x-go.N` version math for the shell update checker (M4 slice 2).
// Fork releases are tagged `v<semver>-go.<N>` (fork-release.yml trigger). Anything
// that does not match that shape — an upstream-style tag that ever lands on the
// mirror, a stray hotfix line — is NOT our release line and parses to null, so the
// checker reports "feed says nothing about a go build" instead of nagging.

export interface GoVersion {
  major: number;
  minor: number;
  patch: number;
  go: number;
}

const GO_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)-go\.(\d+)$/;

export function parseGoVersion(raw: string | null | undefined): GoVersion | null {
  if (typeof raw !== "string") return null;
  const match = GO_VERSION_RE.exec(raw.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    go: Number(match[4]),
  };
}

/** Negative when a < b, 0 equal, positive a > b. Numeric per segment (go.10 > go.9). */
export function compareGoVersions(a: GoVersion, b: GoVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || a.go - b.go;
}
