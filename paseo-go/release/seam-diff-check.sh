#!/usr/bin/env bash
# Seam assertion (external-audit round #1): every upstream touchpoint file's diff
# against the current upstream seed must equal its blessed snapshot in
# paseo-go/release/seams/. Any drift = a re-stick happened (or drifted silently)
# and MUST be reviewed before the merge/ship. After reviewing a legitimate
# re-stick: `seam-diff-check.sh --bless` then eyeball `git diff` of the snapshots.
#
# The anchor = the seed commit recorded in seams/anchor (updated at each upstream
# sync: `git log --format=%H --grep="snapshot seed" -1 | head -1`).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIR=paseo-go/release/seams
ANCHOR=$(cat "$DIR/anchor")
FILES=$(cat "$DIR/files.txt")
MODE="${1:-check}"
fail=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  snap="$DIR/$(echo "$f" | tr '/' '_').diff"
  cur=$(mktemp)
  git diff "$ANCHOR" HEAD -- "$f" >"$cur"
  if [ "$MODE" = "--bless" ]; then
    cp "$cur" "$snap"
    echo "blessed: $f ($(wc -l <"$snap") lines)"
  elif ! diff -q "$snap" "$cur" >/dev/null 2>&1; then
    echo "SEAM-DRIFT: $f (snapshot vs current diff-of-diffs below)"
    diff "$snap" "$cur" | head -40 || true
    fail=1
  else
    echo "seam ok: $f"
  fi
  rm -f "$cur"
done <<<"$FILES"
[ "$fail" = 0 ] && echo "SEAMS-OK (anchor ${ANCHOR:0:7})" || { echo "SEAMS-FAIL — review, then --bless"; exit 1; }
