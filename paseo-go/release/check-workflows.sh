#!/usr/bin/env bash
# Mechanical gate (external-audit round): the ONLY workflow allowed to be active
# on the public mirror is our own fork-release.yml. Upstream workflows that are
# "unregistered" (6 files, mechanism never root-caused) are NOT a defense —
# registration is server state that can silently come back. Run after every
# upstream sync AND every release; see BUILD.md §6.4.
set -euo pipefail
REPO="${REPO:-Karl0007/paseo-go}"
EXPECTED=".github/workflows/fork-release.yml"
ACTUAL=$(gh api "repos/$REPO/actions/workflows?per_page=100" \
  --jq '.workflows[] | select(.state=="active") | .path' | sort)
if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "WORKFLOWS-OK: active = fork-release.yml only"
  exit 0
fi
echo "WORKFLOWS-FAIL: unexpected active set (expected exactly: $EXPECTED)"
comm -13 <(echo "$EXPECTED") <(echo "$ACTUAL") | while read -r f; do
  wid=$(gh api "repos/$REPO/actions/workflows" --jq ".workflows[] | select(.path==\"$f\") | .id")
  echo "disabling $f (id=$wid)"
  gh api -X PUT "repos/$REPO/actions/workflows/$wid/disable" >/dev/null
done
# Re-verify after auto-disable; anything STILL active needs a human (protected?).
LEFT=$(gh api "repos/$REPO/actions/workflows?per_page=100" \
  --jq '.workflows[] | select(.state=="active") | .path' | sort)
[ "$LEFT" = "$EXPECTED" ] && { echo "WORKFLOWS-OK after auto-disable"; exit 0; }
echo "FAIL: still active:"; echo "$LEFT"; exit 1
