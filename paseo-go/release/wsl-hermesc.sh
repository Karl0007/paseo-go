#!/bin/sh
# C13 release bytecode compile via WSL2 (linux64 hermesc = Optimized build).
# Output MUST land on VM-native fs first (drvfs mmap write yields 0 bytes),
# then copy back to the gradle-expected path.
set -x
mkdir -p /mnt/c
mount -t drvfs C: /mnt/c 2>/dev/null
B=/mnt/c/work/paseo-go/packages/app/android/app/build/generated/assets/createBundleReleaseJsAndAssets
W=/dev/shm/hbc-work
rm -rf $W; mkdir -p $W
cp "$B/index.android.bundle" $W/in.js
echo CP_DONE
T0=$(date +%s)
/usr/bin/time -v /mnt/c/work/paseo-go/node_modules/react-native/sdks/hermesc/linux64-bin/hermesc \
  -w -emit-binary -max-diagnostic-width=80 -out $W/out.hbc $W/in.js 2>$W/time.txt
RC=$?
T1=$(date +%s)
echo HERMESC_EXIT=$RC
echo WALL=$((T1-T0))
grep -E "Maximum resident|Elapsed" $W/time.txt
ls -la $W/out.hbc
head -c 8 $W/out.hbc | od -An -tx1
cp $W/out.hbc "$B/index.android.bundle.hbc"
cp $W/out.hbc /mnt/c/tmp/out.hbc
echo COPYBACK_EXIT=$?
