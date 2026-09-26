# C13 release 冒烟 adb 序列（testID 地图 + 步骤脚本）

ADB="$LOCALAPPDATA/Android/platform-tools/adb.exe"
S=AHPEBB1826005071
PKG=app.paseo.shell # release 正式包（debug 壳是 app.paseo.shell.debug）
EV=C:/work/paseo-go/paseo-go/evidence/C13

shot() { "$ADB" -s $S exec-out screencap -p > "$EV/$1.png"; }
dump() { "$ADB" -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null && "$ADB" -s $S shell cat /sdcard/ui.xml; }
tap()  { "$ADB" -s $S shell input tap "$1" "$2"; }
txt()  { "$ADB" -s $S shell input text "$1"; } # ⚠ C3 记录：可能不进 RN 受控输入，先实测
find() { grep -o "resource-id=\"$1\"[^>]_bounds=\"\[[0-9]_,[0-9]_\]\[[0-9]_,[0-9]\*\]\"" ; } # 管道接 dump 输出

## 0. 装机 + 首启（无 metro 验证）

"$ADB" -s $S install -r -d C:/work/paseo-go/packages/app/android/app/build/outputs/apk/release/app-release.apk
"$ADB" -s $S shell dumpsys deviceidle whitelist +$PKG
"$ADB" -s $S shell am force-stop $PKG
"$ADB" -s $S shell am start -n $PKG/$PKG.MainActivity # MainActivity 类名装机后 dumpsys package 核对

# 断言：logcat 无 metro/8081 请求；欢迎页出现 = 离线 bundle OK

shot 00-welcome

## 1. 双主机连接（欢迎页→直接连接）

# dump 找 resource-id="direct-host-input" bounds → tap → txt "192.168.31.190"

# direct-port-input → "6767"；direct-ssl-toggle 保持关；direct-host-submit → 连接

# 第二台：对话 tab 顶栏胶囊 shell-host-pill → shell-host-sheet-connect → 6768

shot 01-host-connected / 01b-host-sheet-two-hosts

## 2. 会话列表四态灯

# shell-chats-list；行 testID 前缀 shell-chat-row-；灯=chat-status-light 颜色

# 造四态：idle(存量) / running(mock load-test) / needs_input(mock emit synthetic plan approval) / failed(断网或错误 prompt)

npx tsx packages/cli/src/index.js run "Reply with exactly: C13 clean reply OK" --provider codex --cwd C:/work/paseo-go --title "C13 消息" --background --json
npx tsx packages/cli/src/index.js run "C13 等待批准：emit a synthetic plan approval" --provider mock --mode approval-test --cwd C:/work/paseo-go --background --json
shot 02-list-four-states

## 3. 长按菜单五动作（置顶/重命名/归档/停止/删除）

# 长按行 600ms+：input swipe X Y X Y 700（原地）→ 原生菜单 → dump 找菜单项文本

shot 03-longpress-menu

# 重命名走 ChatRenamePage（输入受限则记"到提交动作发出"）

## 4. 置顶 + 拖拽换位（≥50px/s）

# 先置顶 ≥3 行；拖第一行到第三行位：swipe 距离 350px 时长 6000ms（≈58px/s）

"$ADB" -s $S shell input swipe X1 Y1 X1 $((Y1+350)) 6000
shot 04-drag-before / 04-drag-during / 04-drag-after

# 仍不可复现 → MANUAL-PENDING（真人手指 5 秒 + 编排者截图）

## 5. 进会话发消息

# tap shell-chat-row-<key> → 官方会话路由 → composer 输入（受控输入限制同上）→ 发送

shot 05-session-reply

## 6. needs_input 通知补拍（C11 遗留）

# mock approval-test agent 挂起 → 前台通知（pgn payload）→ 下拉通知栏

"$ADB" -s $S shell cmd notification post -h  # 仅查询；实拍用下拉
"$ADB" -s $S shell swipe 800 10 800 800 300 # 下拉通知栏
shot 06-notify-shade

# 点击通知 → 直达会话 → 批准（Implement 按钮）

shot 06b-tap-lands-session / 06c-approved

## 7. 文件浏览 + apk 下载分享

# 工作区 tab shell-workspace-list → tap 项目行 → 文件屏（嵌官方 FileExplorerPane）

# 浏览到 packages/app/android/app/build/outputs/apk/release/ → tap app-release.apk

# → 二进制信息卡 shell-preview-binary-card → shell-preview-binary-card-download → -share

shot 07-files / 07b-binary-card / 07c-share-sheet

## 8. 收藏 + 快捷指令

# 长按文件行 → 收藏；收藏夹 shell-favorite-row-；快捷指令 shell-workspace-new-command → 表单 → shell-command-save → shell-command-row- 点击一键执行

shot 08-favorite / 08b-command-run

## 9. 导入 + 搜索

# ＋菜单 shell-import-chat → shell-import-host → 多选 → shell-import-submit

# 会话搜索 shell-chats-search；文件搜索 shell-workspace-search → 结果 shell-workspace-search-results

shot 09-import / 09b-search

## 10. 胶囊三动作 + back 回会话

# 进会话 → 浮层胶囊 shell-session-header-<key> → shell-session-menu-open-<key> → 查看项目文件（(detail)/files C16 路由）→ back 回会话 → 停止/重命名

shot 10-capsule-menu / 10b-capsule-files-back

## 11. 壳设置开关回官方 IA 再回壳

# 我的 tab → me-shell-mode-row → shell-mode-switch 关 → 重启 app → 官方 IA → 再开回壳

shot 11-official-ia / 11b-back-to-shell

## 12. 暗色抽查 + 关于页

# 系统切暗色 → 对话列表 + 工作区两屏

# 关于页 me-about-row：期望 "Paseo Go 0.1.0" + "上游 paseo @ db4fd334"

shot 12-dark-chats / 12b-dark-workspace / 12c-about

## 13. 收尾

"$ADB" -s $S shell am force-stop $PKG

## 附：hermesc 最后手段（等 Main 号令才动）

WSL2（非 Docker Desktop）内跑 `node_modules/react-native/sdks/hermesc/linux64-bin/hermesc`（VM 自带 swap）：
`hermesc -w -emit-binary -out /mnt/c/.../index.android.bundle.hbc /mnt/c/.../index.android.bundle`
→ 产物改名放回 `createBundleReleaseJsAndAssets/index.android.bundle`（bytecode 覆盖 JS）
→ 但 `-x :app:createBundleReleaseJsAndAssets` 被 AGP 硬接线禁（mapReleaseSourceSetPaths 报错，attempt7 实锤）；
改法=临时把 build.gradle 里 afterEvaluate 补丁换成 `task.hermesEnabled.set(false)`（任务跑 export 但跳过 hermesc），
bytecode 由 WSL2 侧手工覆盖回 bundle 路径。改动构建链，属最后手段。

## 附2：已确认事实

- release MainActivity = `app.paseo.shell/app.paseo.shell.MainActivity`（AndroidManifest 核对）
- EXPO_PUBLIC_PASEO_GO_UPSTREAM 内联机制已证：sentinel=deadbeef01 export 后 bundle 内恰 1 处命中、无运行时 process.env 查找
- debug.keystore 由 prebuild 落在 `android/app/debug.keystore`，release signingConfig=debug（正式签名 TODO 已记 BUILD.md §3.5-5）
- `--minify true` 生效需 afterEvaluate 覆盖（插件在 configureEach 之后才 set；attempt6 教训）
