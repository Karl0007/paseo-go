#!/usr/bin/env bash
# C34 真机复现脚本草案（分析轮产物，未验证执行——设备波跑通后再归档进卡）。
# 目的：分离候选 1（persist 写 × force-stop 竞态，dev+release 都可能）与候选 2（metro/dev-only）。
# 纪律（C19 教训内建）：
#   T1 每次 force-stop 后断言进程真的死了（C19 实锤过静默失败：am start 回 "delivered to running instance"）。
#   T2 坐标一律从 uiautomator dump 现取，禁硬编码（C19 实锤 ×1.63 缩放滑点 + 列表位移）。
#   T3 每次变异后、force-stop 前，先断言行已渲染（内存态确认）；重启后再断言（磁盘态确认）。
#   T4 探针名唯一化（含轮次+epoch），杜绝 C19 那种「上一轮残留态误读」。
#   T5 磁盘真相只查 databases/RKStorage（C19 查 files/async-storage 是错的——那是 expo-fs 布局）。
# 用法：DEBUG 轮 PKG=app.paseo.shell.debug（metro 需在跑）；RELEASE 轮 PKG=app.paseo.shell（无 metro，天然排除候选 2）。
set -euo pipefail
ADB="${ADB:-$LOCALAPPDATA/Android/platform-tools/adb.exe}"
SER="${SER:-AHPEBB1826005071}"
PKG="${PKG:?PKG=app.paseo.shell.debug|app.paseo.shell}"
HOSTID="${HOSTID:-srv_qwLjUbVgXsbm}"   # 从 ui dump 的 shell-favorite-row-* 现认，勿信默认值
adb_() { "$ADB" -s "$SER" "$@"; }

assert_dead() {  # T1
  for i in 1 2 3 4 5; do
    pid="$(adb_ shell pidof "$PKG" || true)"
    [ -z "${pid// /}" ] && return 0
    sleep 1; adb_ shell am force-stop "$PKG"
  done
  echo "FATAL: force-stop did not kill $PKG (C19-style silent failure) — abort round" >&2; exit 2
}
dump() { adb_ shell uiautomator dump /sdcard/ui.xml >/dev/null && adb_ shell cat /sdcard/ui.xml; }
assert_row() { # $1=resource-id 子串 $2=应存在(1)/应消失(0)
  n=$(dump | grep -o "resource-id=\"$1[^\"]*\"" | sort -u | wc -l)
  if [ "$2" = 1 ] && [ "$n" -eq 0 ]; then echo "FAIL: row $1 missing"; return 1; fi
  if [ "$2" = 0 ] && [ "$n" -ne 0 ]; then echo "FAIL: row $1 still present"; return 1; fi
  echo "OK: $1 present=$n"
}
tap_id() { # T2：按 resource-id 取中心点
  b=$(dump | tr '>' '\n' | grep -o "resource-id=\"$1\"[^/]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" | head -1 \
      | grep -o '[0-9]*' | paste -sd' ' -)
  set -- $b; adb_ shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 ))
}
cold_start() { adb_ shell am start -n "$PKG"/app.paseo.shell*.MainActivity >/dev/null; sleep "${LAUNCH_WAIT:-45}"; }
to_workspace() { adb_ shell am start -a android.intent.action.VIEW -d "paseogo://chats" >/dev/null; sleep 3; tap_id "shell-tab-workspace" 2>/dev/null || adb_ shell input tap 800 2490; sleep 2; }

fav_round() { # $1=轮名 $2=force-stop 前等待秒
  tag="C34-$1-$(date +%s)"
  # 前置：进入工作区 → 文件列表长按 AGENTS.md（或任一确定文件）→ 收藏
  to_workspace
  adb_ shell input swipe 400 600 400 600 650; sleep 1   # 示例：长按首个确定行；设备波按 dump 实际 bounds 改写
  # TODO(设备波)：长按目标文件行 → 菜单「收藏」；坐标 tap_id/dump 现取
  sleep 2
  assert_row "shell-favorite-row-$HOSTID" 1              # T3 内存态确认
  adb_ shell am force-stop "$PKG"; assert_dead            # T1
  sleep 2; cold_start
  to_workspace
  assert_row "shell-favorite-row-$HOSTID" "${3:-1}"       # T3 磁盘态确认
}

cmd_round() { # $1=轮名 $2=等待秒（当前草案与 fav_round 同构；设备波补表单保存路径，保存按钮 bounds 现取）
  : # TODO(设备波)：新建快捷指令 → 名称 C34-$1 → 保存（按钮坐标 dump 现取）→ assert shell-command-row- → force-stop → 重启 → assert
  echo "cmd_round: 设备波按 T2/T3 补表单路径（C19 教训：键盘开合致按钮位移，保存前 dump 复核 bounds）"
}

disk_truth() { # T5，仅 debug 包（release 不可 run-as → 跳过，UI 断言即口径）
  [ "$PKG" != "app.paseo.shell.debug" ] && { echo "release build: run-as unavailable, skip disk truth"; return 0; }
  adb_ exec-out run-as app.paseo.shell.debug cat databases/RKStorage > /tmp/RKStorage-"$1".db
  # PC 端：sqlite3 /tmp/RKStorage-A.db "select key, substr(value,1,200) from catalystLocalStorage where key like 'paseoGo.%';"
  echo "dumped /tmp/RKStorage-$1.db — 用 sqlite3 查 paseoGo.* 行核对 items"
}

# ── 矩阵（debug 与 release 各跑一遍；release 无 metro，候选 2 自动排除）────────────
# Round A（竞态探针）：收藏 → ≤1s force-stop → 重启 → 断言存在
fav_round A 0 1; disk_truth A
# Round B（对照）：收藏 → sleep 10 → force-stop → 重启 → 断言存在
fav_round B 10 1; disk_truth B
# 判读：A 挂 B 过=候选 1 成立（写未 flush）；A/B 都过=复现失败，C19 观察作废（候选 4 定案）；
# A/B 都挂=另有因（查 disk_truth 的 items 内容 → 区分「从未写入」vs「写入后被旧快照覆盖」=hydration 竞态）。
# 每轮 ≥3 次重复（force-stop 时机抖动），并记录设备 logcat：adb logcat -d | grep -i "Unhandled Promise\|AsyncStorage"
