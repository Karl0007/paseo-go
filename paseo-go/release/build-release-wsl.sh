#!/usr/bin/env bash
# C13 Paseo Go release build via WSL2 bytecode (paseo-go/BUILD.md §3.5 附录).
# Reentrant & idempotent: run with PHASES="1 2 3 4" (default all). Safe to
# re-run after any failure; each phase converges from on-disk state.
#
# Why: win64 npm hermesc is a DEBUG build and OOMs ("LLVM ERROR: out of memory")
# on the 23.8MB minified bundle without a page file; linux64-bin hermesc is an
# Optimized build and compiles it in ~90s inside a WSL2 VM (needs memory=16GB).
# Output must be written on the VM-native fs (drvfs mmap write yields 0 bytes),
# then copied back. gradle then packages with the bundle task skipped via the
# PG_SKIP_BUNDLE marker (plain `-x` breaks AGP generated-source wiring).
set -euo pipefail

REPO=C:/work/paseo-go
APP=$REPO/packages/app
ANDROID=$APP/android
GEN=$ANDROID/app/build/generated/assets/createBundleReleaseJsAndAssets
MARKER=$ANDROID/app/build/PG_SKIP_BUNDLE
APK=$ANDROID/app/build/outputs/apk/release/app-release.apk
WSLCONFIG="$USERPROFILE/.wslconfig"
WSLCONFIG_BAK="$USERPROFILE/.wslconfig.bak-c13"
PHASES="${PHASES:-0 1 2 3 4}"
export ENTRY_FILE=packages/app/index.ts
export PASEO_GO=1
export EXPO_PUBLIC_PASEO_GO_SHELL=1
export EXPO_PUBLIC_PASEO_GO_UPSTREAM="${EXPO_PUBLIC_PASEO_GO_UPSTREAM:-db4fd334}"
# M4 slice 2: bake the go-line version the shell update checker compares against
# (default = paseo-go/VERSION, the release ritual bumps it per line; override for
# a rebuild of an older tag).
export EXPO_PUBLIC_PASEO_GO_VERSION="${EXPO_PUBLIC_PASEO_GO_VERSION:-$(cat "$REPO/paseo-go/VERSION" 2>/dev/null || echo 0.10.2-go.0)}"
run() { [[ " $PHASES " == *" $1 "* ]]; }

if run 0; then
  echo "== Phase 0: ensure gradle patch present (prebuild regenerates it away) =="
  if ! grep -q "PG_SKIP_BUNDLE" "$ANDROID/app/build.gradle"; then
    cat >> "$ANDROID/app/build.gradle" <<'PGPATCH'

// Paseo Go release build (C13; paseo-go/BUILD.md §3.5) — appended by
// release/build-release-wsl.sh phase0. afterEvaluate is REQUIRED: the RN
// plugin's registration block sets minifyEnabled/hermesEnabled AFTER
// configureEach actions run. minify=true shrinks the hermesc input 48->24MB;
// hermesEnabled=false lets the bundle task finish (export only) so WSL2 can
// produce bytecode; the marker makes the task skip on the final assemble.
afterEvaluate {
    tasks.named("createBundleReleaseJsAndAssets").configure { task ->
        task.minifyEnabled.set(true)
        task.hermesEnabled.set(false)
        def skipMarker = new File(project.buildDir, "PG_SKIP_BUNDLE")
        task.onlyIf { !skipMarker.exists() }
    }
}
PGPATCH
    echo "patch appended"
  else
    echo "patch already present"
  fi
  # entry stub for gradle @InputFile (ENTRY_FILE resolution side effect).
  # Content is the lint-clean version (oxlint-disable on the side-effect import)
  # so a clean build's `npm run lint` stays green — the generator is the single
  # source; the on-disk stub is untracked and matches it byte-for-byte (R2-26).
  mkdir -p "$APP/packages/app"
  cat > "$APP/packages/app/index.ts" <<'STUB'
// Gradle input stub for release builds (paseo-go/BUILD.md §3.5, C13).
// With ENTRY_FILE=packages/app/index.ts set in the build environment,
// @react-native/gradle-plugin resolves react.entryFile to THIS path for its
// input validation, while `expo export:embed` receives the workspace-relative
// path and bundles the REAL entry (packages/app/index.ts) from the metro
// server root. Metro never loads this file; the re-export keeps it honest.
// oxlint-disable-next-line import/no-unassigned-import
import "../../index";
STUB
fi

if run 1; then
  echo "== Phase 1: gradle export (minified JS, hermesc disabled by patch) =="
  rm -f "$MARKER" "$GEN/index.android.bundle.hbc"
  (cd "$ANDROID" && ./gradlew.bat :app:createBundleReleaseJsAndAssets \
     --no-daemon --console=plain --max-workers=2)
  test -s "$GEN/index.android.bundle"
  # Anti-stale guard (main's rule): record THIS bundle's hash+time; phase2
  # asserts the produced bytecode is newer than the bundle it was fed.
  sha256sum "$GEN/index.android.bundle" | awk '{print $1}' > "$GEN/.bundle-sha"
  date +%s > "$GEN/.bundle-ts"
fi

if run 2; then
  echo "== Phase 2: hermesc bytecode (native win64 primary, WSL2 fallback) =="
  # win64 npm hermesc is a DEBUG build: peak commit ~21GB, needs an IDLE machine
  # (FreeVis >= 23GB — stop metro/daemons/vitest first, BUILD.md known-issue #6).
  freevis_gb=$(powershell -NoProfile -Command '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB,1)')
  ok=0
  if awk -v v="$freevis_gb" 'BEGIN{exit !(v>=23)}'; then
    echo "native hermesc (FreeVis=${freevis_gb}GB), ~5min, machine must stay idle"
    "$REPO/node_modules/react-native/sdks/hermesc/win64-bin/hermesc.exe" \
      -w -emit-binary -max-diagnostic-width=80 \
      -out "$GEN/index.android.bundle.hbc" "$GEN/index.android.bundle" \
      && ok=1
  else
    echo "FreeVis=${freevis_gb}GB < 23GB — skipping native"
  fi
  if [[ $ok -ne 1 ]]; then
    # Fallback: linux64 Optimized hermesc in WSL2 (needs memory=16GB VM; see
    # wsl-hermesc.sh for the drvfs-mmap + rootfs-ro lessons)
    echo "falling back to WSL2 linux hermesc"
    if [[ -f "$WSLCONFIG" ]] && ! grep -q "memory=16GB" "$WSLCONFIG"; then
      cp "$WSLCONFIG" "$WSLCONFIG_BAK" 2>/dev/null || true
      printf '[wsl2]\nmemory=16GB\nprocessors=8\nswap=8GB\n' > "$WSLCONFIG"
    fi
    wsl --shutdown || true; sleep 3
    wsl -d docker-desktop -- /bin/sh -c \
      "mkdir -p /mnt/c; mount -t drvfs C: /mnt/c; exec /bin/sh /mnt/c/work/paseo-go/paseo-go/release/wsl-hermesc.sh"
  fi
  test "$(sha256sum "$GEN/index.android.bundle" | awk '{print $1}')" = "$(cat "$GEN/.bundle-sha")" \
    || { echo "FATAL: bundle changed between phase1 and phase2"; exit 1; }
  test -s "$GEN/index.android.bundle.hbc"
  [[ $(stat -c %Y "$GEN/index.android.bundle.hbc") -ge $(cat "$GEN/.bundle-ts") ]] \
    || { echo "FATAL: bytecode older than the fresh bundle — stale artifact"; exit 1; }
  # swap bytecode into the exact asset path gradle expects (task action does
  # bytecodeFile.moveTo(bundleFile) — we replicate that end state)
  mv -f "$GEN/index.android.bundle.hbc" "$GEN/index.android.bundle"
  head -c 12 "$GEN/index.android.bundle" | od -An -tx1 | grep -qi "c6 1f bc 03 c1 03 19 1f" \
    && echo "bytecode header OK" || echo "WARN: hbc header unexpected, verify"
fi
if run 3; then
  echo "== Phase 3: assembleRelease with bundle task skipped =="
  mkdir -p "$(dirname "$MARKER")"; touch "$MARKER"
  (cd "$ANDROID" && ./gradlew.bat :app:assembleRelease --no-daemon --console=plain \
     -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease \
     -x generateReleaseLintModel -x generateReleaseLintVitalModel \
     --max-workers=2 -PreactNativeArchitectures=arm64-v8a \
     -Pandroid.enableMinifyInReleaseBuilds=true)
fi

if run 4; then
  echo "== Phase 4: finalize =="
  rm -f "$MARKER"
  if [[ -f "$WSLCONFIG_BAK" ]]; then cp "$WSLCONFIG_BAK" "$WSLCONFIG"; fi
  ls -la "$APK"
  sha256sum "$APK"
fi
echo "build-release-wsl.sh DONE"
