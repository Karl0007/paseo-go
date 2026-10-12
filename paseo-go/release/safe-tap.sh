#!/usr/bin/env bash
# Bounds-dumped tap (external-audit round #6). The go.16 device round sent a
# probe string into the user's real journal because a tap coordinate was guessed
# and the "取消" hit missed. This helper dumps uiautomator bounds for the element
# at (x,y) BEFORE tapping and refuses if the label doesn't contain the expected
# text — turning "注入前 dump bounds" from a note into a mechanical precondition.
#
# usage: safe-tap.sh <x> <y> <expected-substring>
#        (ANDROID_SERIAL / ADB env honored; ADB defaults to adb on PATH)
set -euo pipefail
X="${1:?usage: safe-tap.sh <x> <y> <expected-substring>}"
Y="${2:?usage: safe-tap.sh <x> <y> <expected-substring>}"
EXPECT="${3:?usage: safe-tap.sh <x> <y> <expected-substring>}"
ADB="${ADB:-adb}"
# Auto-detect adb: bare `adb` on PATH, else the known platform-tools exe. Some
# harnesses cannot exec the .exe directly; if the plain call errors "not found",
# fall back to invoking the absolute path (git-bash may still run it, or the
# caller can export ADB='powershell -NoProfile -Command &"...adb.exe"').
if ! command -v "$ADB" >/dev/null 2>&1 && [ ! -x "$ADB" ]; then
  for c in /c/Users/*/AppData/Local/Android/platform-tools/adb.exe \
           /c/Android/Sdk/platform-tools/adb.exe; do
    [ -f "$c" ] && { ADB="$c"; break; }
  done
fi
SER="${ANDROID_SERIAL:+-s $ANDROID_SERIAL}"
DUMP="$("$ADB" $SER shell uiautomator dump /sdcard/safe-tap.xml 2>/dev/null \
  | sed -n 's/.*dumped to: \{0,1\}\([^ ]*\).*/\1/p')"
DUMP="${DUMP:-/sdcard/safe-tap.xml}"
XML="$("$ADB" $SER shell cat "$DUMP" 2>/dev/null)"
# Smallest node whose bounds contain (x,y) = the actual hit target; print its
# text/content-desc/resource-id, then gate on EXPECT.
HIT=$(printf '%s' "$XML" | tr '>' '\n' | awk -v x="$X" -v y="$Y" '
  match($0, /bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"/) {
    b=substr($0, RSTART, RLENGTH)
    gsub(/[^0-9]/," ",b); split(b,a," ")
    x1=a[1]; y1=a[2]; x2=a[3]; y2=a[4]
    if (x>=x1 && x<=x2 && y>=y1 && y<=y2) {
      area=(x2-x1)*(y2-y1)
      if (best=="" || area<bestarea) { bestarea=area; best=$0 }
    }
  }
  END { print best }')
LABEL=$(printf '%s' "$HIT" | sed -n 's/.*text="\([^"]*\)".*/\1/p; s/.*content-desc="\([^"]*\)".*/\1/p' | tr '\n' '|')
echo "hit-node: ${LABEL:-<no text>}  bounds=[$(printf '%s' "$HIT" | sed -n 's/.*bounds="\([^"]*\)".*/\1/p')]"
if ! printf '%s' "$LABEL" | grep -qiF -- "$EXPECT"; then
  echo "SAFE-TAP-ABORT: expected label containing '$EXPECT' at ($X,$Y), got '${LABEL:-<empty>}'. NOT tapping."
  exit 2
fi
"$ADB" $SER shell input tap "$X" "$Y"
echo "SAFE-TAP-OK: tapped ($X,$Y) on '$EXPECT'"
