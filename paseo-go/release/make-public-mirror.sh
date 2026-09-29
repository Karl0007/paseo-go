#!/usr/bin/env bash
# 发布镜像重建：dev 仓（含证据、partial clone）→ 公开镜像仓（无证据、完整对象、重放历史）
# 单向：dev → public，永不反向 push。证据/临时件永不进镜像（format-patch 排除 + gitignore 双保险）。
#
# usage: make-public-mirror.sh <base-tarball.tar.gz> <patches-dir> <target-dir> [push-remote-url]
# 前置：dev 仓里 `git format-patch <fork-base>..paseo-go/v0.1.0 --binary -- . ':(exclude)paseo-go/evidence'`
set -euo pipefail
TARBALL="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
PATCHES="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
TARGET="$3"; PUSH="${4:-}"
BASE_SHA_IN_MESSAGE="db4fd334"

rm -rf "$TARGET"; mkdir -p "$TARGET"
tar -xzf "$TARBALL" -C "$TARGET" --strip-components=1 || true
# Windows 无 symlink 特权：把归档里的符号链接物化成目标文件副本（镜像用途无害；merge 在 dev 仓做）
tar -tzvf "$TARBALL" | awk '$1 ~ /^l/ {print $NF, $6}' | while read -r linktarget innerpath; do
  rel="${innerpath#*/}"
  [ -e "$TARGET/$rel" ] && continue
  mkdir -p "$(dirname "$TARGET/$rel")"
  cp "$TARGET/$(dirname "$rel")/$linktarget" "$TARGET/$rel" 2>/dev/null || echo "symlink materialize failed: $rel -> $linktarget"
done

cd "$TARGET"
git init -q -b paseo-go/v0.1.0
git config core.autocrlf false
git config core.safecrlf false
git add -A
git commit -q -m "upstream getpaseo/paseo @ ${BASE_SHA_IN_MESSAGE} snapshot (public mirror root; true base commit lives in upstream history)"

git am -q "$PATCHES"/*.patch

# 版本 tag 落位：按消息找 v0.2.0 README roll 提交
TAGC=$(git log --format="%H %s" | grep "README header roll to v0.2.0" | head -1 | cut -d" " -f1 || true)
[ -n "$TAGC" ] && git tag paseo-go-v0.2.0 "$TAGC" || echo "WARN: v0.2.0 tag anchor not found"

# 自检：镜像历史零证据
RES=$(git log --all --format= --name-only | grep -c "^paseo-go/evidence" || true)
echo "evidence-in-mirror-history: $RES (must be 0)"
[ "$RES" = "0" ] || { echo "ABORT: mirror contaminated"; exit 1; }
echo "commits: $(git rev-list --count HEAD), tree files: $(git ls-files | wc -l)"

if [ -n "$PUSH" ]; then
  git remote add origin "$PUSH"
  git push -q origin paseo-go/v0.1.0 --tags
  echo "pushed to $PUSH"
fi
