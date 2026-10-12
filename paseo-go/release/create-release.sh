#!/usr/bin/env bash
# Create/update a Paseo Go GitHub release — the ONLY sanctioned way to open a
# release line (external-audit round; go.13 incident: a hand-rolled `gh release
# create` forgot --prerelease, which let the then-active deploy-website.yml
# really run against the publish event). This script hardcodes --prerelease and
# stamps the Apache-2.0 §4(b) modified-build attribution into the body header.
#
# usage: create-release.sh <tag> [asset ...]
#   e.g. create-release.sh v0.10.2-go.17 app-release.apk app-release.apk.sha256
# The assemble job later rebuilds the full asset table; this body is the opener.
set -euo pipefail
TAG="${1:?usage: create-release.sh <tag> [asset ...]}"
shift || true
REPO="${REPO:-Karl0007/paseo-go}"
BODY=$(mktemp)
{
  echo "Paseo Go $TAG — **modified build of [getpaseo/paseo](https://github.com/getpaseo/paseo)** (Apache-2.0). Fork changes are additive; shell docs live in \`paseo-go/\` (entry point: \`paseo-go/README.md\`)."
  echo
  echo "## Assets"
} >"$BODY"
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  gh release edit "$TAG" -R "$REPO" --title "Paseo Go $TAG" --prerelease --notes-file "$BODY"
else
  gh release create "$TAG" -R "$REPO" --title "Paseo Go $TAG" --prerelease --notes-file "$BODY"
fi
rm -f "$BODY"
if [ "$#" -gt 0 ]; then
  gh release upload "$TAG" -R "$REPO" "$@" --clobber
fi
# Post-condition: prerelease flag really set (the whole point of this script).
PR=$(gh release view "$TAG" -R "$REPO" --json isPrerelease --jq .isPrerelease)
[ "$PR" = "true" ] || { echo "FAIL: release $TAG is not prerelease"; exit 1; }
echo "RELEASE-OK $TAG prerelease=true assets=$(gh release view "$TAG" -R "$REPO" --json assets --jq '.assets|length')"
