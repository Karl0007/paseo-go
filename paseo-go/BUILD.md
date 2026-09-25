# Paseo Go — 开发闭环 Runbook（C0 产物）

> 本机实测通过（2026-09-25，Windows 11 / Node v24.13.0 / 华为 MatePad BRT-W09）。
> 后续所有卡按此闭环执行：改代码 → metro 热更或重打 APK → adb 装机 → adb 截图 → 读图。

## 0. 本机环境事实（先读，省一半坑）

| 项               | 值                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 包管理器         | **npm workspaces（package-lock.json），不是 pnpm**。仓根无 `pnpm-workspace.yaml`，pnpm 会直接报 `The "workspaces" field in package.json is not supported`。任务卡里写的 `pnpm xxx` 一律换成 `npm xxx`（等价门禁见下）                |
| Node             | 本机 v24.13.0 实测全绿（CI 钉 22，`.tool-versions` 亦 22；如遇 ABI 问题再切 22）                                                                                                                                                     |
| JDK              | `C:\java\jdk21.0.11_10`（备用 `C:\java\jdk17.0.10_7`，系统默认 JAVA_HOME 指向 17，gradle 两者皆可）                                                                                                                                  |
| Android SDK      | `C:\Android\Sdk`（`ANDROID_HOME` 已设；platforms 36 / build-tools 35 / cmake 齐）                                                                                                                                                    |
| adb（不在 PATH） | `C:\Users\K\AppData\Local\Android\platform-tools\adb.exe`（bash 里 `"$LOCALAPPDATA/Android/platform-tools/adb.exe"`；另有 `C:\Android\Sdk\platform-tools\adb.exe` 版本较旧，二选一，注意两路 adb server 版本不同会互相 kill server） |
| 验证设备         | 华为 MatePad **BRT-W09**，Android 12，arm64-v8a，serial `AHPEBB1826005071`，屏 1600x2560（竖屏 UI 坐标系 = 1600x2560）                                                                                                               |
| PC LAN IP        | `192.168.31.190`（以太网 3）；平板 wlan0 = `192.168.31.14`，同网段直通                                                                                                                                                               |
| dev 变体包名     | `sh.paseo.debug`（app 名 "Paseo Debug"，与正式 `sh.paseo` 共存）；MainActivity = `sh.paseo.debug.MainActivity`                                                                                                                       |
| ⚠ 内存坑         | 本机**页面文件被禁用**：commit 上限≈物理内存，且 WSL/Docker/用户进程常年吃掉大半（空闲 commit 常 <5GB）。gradle/vitest 必须按下面的限内存参数跑，且**重型任务串行**，见 §2/§3                                                        |
| ⚠ 用户真 daemon  | 用户自己的 paseo daemon 跑在 `~/.paseo` home、监听 Tailscale IP:6767（带密码）。开发 daemon 用 `.dev/paseo-home` + `0.0.0.0:6767`，两者共存互不干扰；CLI 操作开发 daemon 时**必须**带 `PASEO_HOME=C:/work/paseo-go/.dev/paseo-home`  |

无人值守前置（已代做，换设备时重跑）：

```bash
ADB="$LOCALAPPDATA/Android/platform-tools/adb.exe"
"$ADB" -s AHPEBB1826005071 shell settings put global stay_on_while_plugged_in 7
"$ADB" -s AHPEBB1826005071 shell settings put system screen_off_timeout 600000
"$ADB" -s AHPEBB1826005071 shell dumpsys deviceidle whitelist +sh.paseo.debug   # 装完 APK 后才有意义
```

## 1. 依赖安装（仓根，一次性）

```powershell
cd C:\work\paseo-go
$env:ONNXRUNTIME_NODE_INSTALL = "skip"   # 跳过 onnxruntime 大文件下载（CI 同款开关）
node scripts/npm-retry.mjs ci            # 带重试的 npm ci；postinstall 自动跑 patch-package
```

约 2 分钟、2673 包。成功标志：`patch-package ... ✔` x7 + `added 2673 packages`。

## 2. 静态门禁 + 套件（对应证据契约 1/2）

```powershell
cd C:\work\paseo-go
npm run build:server    # typecheck 前置（CI 同序）
npm run typecheck       # 全 workspace tsgo，exit 0 即过
npm run lint            # oxlint，0 warnings 0 errors
# app 套件（vitest）——本机必须限并发，否则 commit 内存 OOM：
cd packages\app
$env:NODE_OPTIONS = "--max-old-space-size=2048"
npx vitest run --pool=threads --maxWorkers=2
```

本机基线结果：**5447/5451 通过**，4 个失败全部是 Windows 环境性失败（与代码无关，勿修——`packages/` 不可动）：

- `src/utils/time.test.ts` x2：断言英文星期（`/Monday/`），本机 zh-CN locale 输出 `星期一`
- `src/changelog/internal/parse-changelog.test.ts` x1：同上 locale（`2026年9月8日` ≠ `September 8, 2026`）
- `src/changelog/internal/parse-changelog.test.ts` x1：`core.autocrlf=true` 检出 CRLF，CHANGELOG 行比对带 `^M`
- `src/git/forges/index.test.ts`：测试自身 Windows bug（`new URL(import.meta.url).pathname` 产生 `/C:/...` 非法路径）

## 3. 构建 Android dev APK（免 EAS 登录，纯本地）

```powershell
cd C:\work\paseo-go\packages\app
$env:JAVA_HOME = "C:\java\jdk21.0.11_10"
$env:APP_VARIANT = "development"
npx expo prebuild --platform android --clean        # ~20s，生成 android/（gitignored）
cd android
.\gradlew.bat :app:assembleDebug --no-daemon -x lint --max-workers=2 `
  "-PreactNativeArchitectures=arm64-v8a" `
  "-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m"
```

- 首构建 ~20 分钟（下依赖+4 个 prefab 原生模块），增量 ~5 分钟。产物：`packages\app\android\app\build\outputs\apk\debug\app-debug.apk`（~150MB）
- `arm64-v8a` 单 ABI 是给本机平板用的加速开关；给别人装机去掉此参数
- **内存坑实录**：默认 `-Xmx4096m` 起不来 daemon（commit 失败）；`mergeExtDexDebug` 阶段最吃内存，若报 "daemon disappeared"，先杀掉残留 java 进程（`Get-Process java`，注意别杀 paseo daemon 的 node）再重跑，任务级缓存会续上
- 等价一键（含装机+起 metro）：仓根 `npm run android:development`——但它会顺带前台起 metro 且用默认内存参数，本机建议用上表分步命令

## 4. 装机 + 连 daemon + 起 app（对应证据契约 3）

```powershell
$ADB = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe"
# 4.1 装机（华为实测无纯净模式拦截，13 秒完成；-d 允许版本降级覆盖）
& $ADB -s AHPEBB1826005071 install -r -d "C:\work\paseo-go\packages\app\android\app\build\outputs\apk\debug\app-debug.apk"
& $ADB -s AHPEBB1826005071 shell dumpsys deviceidle whitelist +sh.paseo.debug

# 4.2 起开发 daemon（Git Bash；隔离 home，监听 LAN 6767）
#     前台窗口跑，或后台：
& "C:\Program Files\Git\bin\bash.exe" -c "cd /c/work/paseo-go && PASEO_LISTEN=0.0.0.0:6767 PASEO_SKIP_DEV_SERVER_BUILD=1 ./scripts/dev-daemon.sh"
# 验证：curl http://192.168.31.190:6767/api/health → 200

# 4.3 起 metro（改 JS 后免重装 APK，即“改代码→装机”闭环的快路径）
cd C:\work\paseo-go\packages\app
$env:APP_VARIANT = "development"; $env:REACT_NATIVE_PACKAGER_HOSTNAME = "192.168.31.190"
npx expo start

# 4.4 USB 反代 metro（平板经 adb 直通 PC 8081，绕开 Wi-Fi 配对页）+ 启动 app
& $ADB -s AHPEBB1826005071 reverse tcp:8081 tcp:8081
& $ADB -s AHPEBB1826005071 shell am start -n sh.paseo.debug/sh.paseo.debug.MainActivity
```

app 首启是 dev launcher：点 `http://localhost:8081` 行 → 首次 bundle 约 2-4 分钟（"Reloading..." 全屏白）。
进入欢迎页后连开发 daemon：**直接连接** → Host `192.168.31.190`、Port `6767`、SSL 关、密码留空 → 连接。
（模拟器替代方案：Host 用 `10.0.2.2`，端口同上。）

给会话列表造真 agent（可选，验证全链路）：

```powershell
cd C:\work\paseo-go
$env:PASEO_HOME = "C:\work\paseo-go\.dev\paseo-home"   # 必须！否则打到用户真 daemon
npx tsx packages/cli/src/index.js run "Reply with exactly: C0 smoke OK" --provider codex --cwd C:/work/paseo-go --title "smoke" --background --json
npx tsx packages/cli/src/index.js delete <agentId> --json   # 用完删
```

### UI 自动化要点（无人值守）

- RN `testID` 在 Android 直接映射 `resource-id`：`adb shell uiautomator dump /sdcard/ui.xml` + `cat` 拉回，按 `resource-id="direct-host-input"` 等找 bounds，`input tap cx cy`
- 文本输入：先 tap 字段，`adb shell input text "192.168.31.190"`（仅 ASCII），`input keyevent 111` 收键盘
- ⚠ 软键盘弹出/收起会移动弹层坐标——**提交前重新 dump 一次**再点
- ⚠ `KEYCODE_BACK` 可能直接退出 app（回桌面/其他 app），导航优先用 app 内 UI 元素
- 华为实测：`adb install` 无拦截无弹窗；`screencap` 正常
- ⚠（C3 实测）dev 壳包名是 `app.paseo.shell.debug`（D3 独立包名），force-stop/am start 用它，不是上表的 `sh.paseo.debug`
- ⚠（C3 实测）`input swipe` 线性注入 + JS 触摸分发有 ~290ms 滞后：长按拖拽（180ms 静止后移动）用 ≤25px/s 的慢速注入会被仲裁判成"静止长按"而弹菜单（人手拖拽 300px/s+ 不会）。测拖拽用 ≥50px/s（如 350px/7000ms）；`input motionevent` 分段注入会重置 downTime、断手势流，不可用
- ⚠（C3 实测）`input text` 不进 RN 受控输入（onChangeText 不触发）——验证输入类 UI 到"页面渲染+提交动作发出"为止，逻辑正确性靠单测
- **深链 scheme 分叉（REVIEW-FIX F8）**：壳包（`PASEO_GO=1`）scheme=`paseogo`，官方保持 `paseo`（`packages/app/app.config.js` 单行三元）。影响：① 官方配对链接从此只拉官方 app，壳的深链自持 `paseogo://`——旧 C14 恢复配方里的 `paseo://me` 在壳包上失效，写作 `paseogo://me`（该配方文本未入库，以本条为准）；② 双包共存时 `paseo://` 归官方，壳只能经 launcher / `am start -n app.paseo.shell[.debug]/…MainActivity` 或 `paseogo://` 拉起；③ 恶意深链面收窄见 F6：预览屏 workspaceRoot 参数不再压过 workspace descriptor（`src/shell/files/preview-root.ts` 有回归测试）。

## 5. 截图采集（对应证据契约 4）

```powershell
$ADB = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe"
& $ADB -s AHPEBB1826005071 exec-out screencap -p > C:\work\paseo-go\paseo-go\evidence\<卡号>\<名称>.png
```

规则：每卡 ≥2 张存 `paseo-go/evidence/<卡号>/`，Agent 必须亲自 read 每张并在报告写结论。
（注意平板可能横竖屏切换：screencap 原图尺寸以实际为准，uiautomator bounds 是**当前方向**的坐标系。）

## 已知问题 / 边界

1. 上表 4 个环境性测试失败（zh-CN locale x3、CRLF x1、forges 测试 Windows 路径 bug x1）——Linux CI 全绿，本机不修（`packages/` 铁律禁改）。
2. 本机页面文件禁用是 gradle/vitest OOM 根因；长期建议用户启用页面文件（系统属性→高级→虚拟内存），启用后可去掉 §2/§3 的限内存参数。
3. `expo run:android` 一键路径在默认内存参数下会死，故 runbook 固化为 prebuild+gradle 分步。
4. EAS 完全不需要：本地 gradle 路径零登录。
5. **聚合连接状态 hook 在 React Compiler 下失效（R1，归类 c）**：官方 `useHostRuntimeConnectionStatuses` 的 `void version` 重算信号会被 `app.config.js` 的 `reactCompiler: true` 剥掉，返回的 Map 只在 serverIds 身份变化时刷新（真机表现：在线 host 永久显示"连接中"）。壳屏必须用 `src/shell/runtime/use-shell-host-statuses.ts`；根因与上游复现见 `paseo-go/R1-upstream-repro.md`。另：给 app 拉新 bundle 后需 force-stop+重启 app（metro 终端 `r` 键经管道不可靠）。
