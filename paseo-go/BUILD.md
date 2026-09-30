# Paseo Go — 开发闭环 Runbook（C0 产物）

> 本机实测通过（2026-09-25，Windows 11 / Node v24.13.0 / 华为 MatePad BRT-W09）。
> 后续所有卡按此闭环执行：改代码 → metro 热更或重打 APK → adb 装机 → adb 截图 → 读图。

## 证据与发布镜像纪律（2026-09-29 起）

- **证据（截图/帧/dump）= 本地档案**：仍存 `paseo-go/evidence/<卡号>/` 并在报告引用路径，但**不入库**（目录已 gitignore；历史里的证据已于同日从公开镜像剥离）。审计=本机磁盘 + 报告 JSON。
- **公开镜像**：`github.com/Karl0007/paseo-go`（public）。**单向重放**：dev 仓 → `release/make-public-mirror.sh`（tarball 根 + `format-patch --binary -- . ':(exclude)paseo-go/evidence'` 重放）→ push。**永不反向 push 镜像**；merge upstream 只在 dev 仓做。发布前重跑脚本=镜像与 dev 同步且自动无证据。
- 临时产物（`.tmp/`、`packages/app/.tmp/`、`packages/app/packages/`）已 gitignore，禁止再入库。

## 0. 本机环境事实（先读，省一半坑）

| 项               | 值                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 包管理器         | **npm workspaces（package-lock.json），不是 pnpm**。仓根无 `pnpm-workspace.yaml`，pnpm 会直接报 `The "workspaces" field in package.json is not supported`。任务卡里写的 `pnpm xxx` 一律换成 `npm xxx`（等价门禁见下）                |
| Node             | 本机 v24.13.0 实测全绿（CI 钉 22，`.tool-versions` 亦 22；如遇 ABI 问题再切 22）                                                                                                                                                     |
| JDK              | `C:\java\jdk21.0.11_10`（备用 `C:\java\jdk17.0.10_7`，系统默认 JAVA_HOME 指向 17，gradle 两者皆可）                                                                                                                                  |
| Android SDK      | `C:\Android\Sdk`（`ANDROID_HOME` 已设；platforms 36 / build-tools 35 / cmake 齐）                                                                                                                                                    |
| adb（不在 PATH） | `C:\Users\K\AppData\Local\Android\platform-tools\adb.exe`（bash 里 `"$LOCALAPPDATA/Android/platform-tools/adb.exe"`；另有 `C:\Android\Sdk\platform-tools\adb.exe` 版本较旧，二选一，注意两路 adb server 版本不同会互相 kill server） |
| 验证设备         | 华为 MatePad **BRT-W09**，Android 12，arm64-v8a，serial `AHPEBB1826005071`（USB）/ **`192.168.31.14:5555`（无线，2026-09-29 起主车道）**，屏 1600x2560（竖屏 UI 坐标系 = 1600x2560）                                                 |
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

> ⚠ **`stay_on_while_plugged_in 7` = 插电即常亮，是耗电主因（2026-09-29 实锤）**：平板插 PC USB 口
> 协商输入仅 **2.5W（500mA×5V，dumpsys `Max charging current: 500000`）**，喂不动常亮屏+测试负载
> （MatePad 亮屏整机 3~5W）→ 连续两天常亮累计净放电，第三次重测当天从 21% 砸到 4%、两次内核 wedge。
> **纪律**：只在主动测试的时段开常亮，**测完/离开即关**：
> `adb shell settings put global stay_on_while_plugged_in 0`。长测/挂机一律挂**墙充**（起步 5V2A=10W，
> 数倍于 PC 口）；`dumpsys battery` 里 `Max charging current` 是判断"这个口到底喂多少瓦"的唯一硬证据。

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

## 3.5 release APK（Paseo Go 正式包，C13 实测闭环）

release 与 debug 同命令族，但有 **四个 release 专属坑**，全部已踩平，照抄即可：

```powershell
cd C:\work\paseo-go\packages\app
$env:JAVA_HOME = "C:\java\jdk21.0.11_10"
# APP_VARIANT 不设 = production；PASEO_GO=1 出壳品牌（app.paseo.shell，与官方共存）
$env:PASEO_GO = "1"
$env:EXPO_PUBLIC_PASEO_GO_SHELL = "1"          # 壳模式 bundle 默认开（首启即壳 IA）
$env:EXPO_PUBLIC_PASEO_GO_UPSTREAM = "919c737c" # 关于页上游 hash（metro 构建期内联，KI-C8-b）
$env:ENTRY_FILE = "packages/app/index.ts"       # 坑①，见下
$env:NODE_OPTIONS = "--max-old-space-size=8192" # terser minify 需要大 node 堆
npx expo prebuild --platform android --clean
```

1. **坑① 入口解析（SDK54 新默认）**：`@expo/config` 现在默认把 metro server root 提升到 **npm workspace 根**（`EXPO_USE_METRO_WORKSPACE_ROOT` 已是默认值），而 RN gradle 插件传 `--entry-file index.ts`（相对 app 目录）→ 必然 `Unable to resolve module ./index.ts from <workspace根>`。修法=构建环境设 `ENTRY_FILE=packages/app/index.ts`（gradle 插件 env 优先级最高，见 `TaskConfiguration.kt`），同时需要存在性桩 `packages/app/packages/app/index.ts`（gradle `@InputFile` 校验用，metro 从不读它；深度是 `../../`，写 `../../../` 会 TS2882；typecheck 会扫到它，属预期；不 commit）。**R2-26 对账结论**：桩由 phase0 **无条件重生成**（heredoc，内容含 `oxlint-disable import/no-unassigned-import`，与工作树版逐字节一致——生成器=唯一真值，fresh-clone 后 lint 不红）；旧版 `[[ -f ]] ||` 只补不盖、短版无 disable，已废。
2. **坑② hermesc OOM（根因级已解）**：插件约定 hermes 启用时 `--minify false`（`minifyEnabled = !hermes`），48MB 未压缩 bundle 喂给 **debug 版 win64 hermesc**（`--version` 自报 DEBUG build；Meta 官方 CLI 只发到 v0.13.0 且同为 debug）→ `LLVM ERROR: out of memory`。定稿两步：
   - (a) minify 先行（48MB→23.8MB）+ 让 bundle 任务不跑 hermesc：`android/app/build.gradle` 末尾的 afterEvaluate 覆盖（**必须 afterEvaluate**——插件注册块在 configureEach 之后才 set，早设会被静默覆盖，attempt6 实锤；**必须 `--console=plain`**——PTY+进度条会把子进程 stderr 管道堵死成 40 分钟假死，attempt1 实锤）：
     ```groovy
     afterEvaluate {
         tasks.named("createBundleReleaseJsAndAssets").configure { task ->
             task.minifyEnabled.set(true)
             task.hermesEnabled.set(false)   // 任务只出 JS，bytecode 由外部补
             def skipMarker = new File(project.buildDir, "PG_SKIP_BUNDLE")
             task.onlyIf { !skipMarker.exists() }   // -x 会断 AGP generated-source 接线（attempt7 实锤）
         }
     }
     ```
     prebuild 会抹掉补丁 → **`release/build-release-wsl.sh` phase0 自动重打**，勿手工。
   - (b) bytecode 编译：**原生 win64 debug hermesc 在整机空闲（FreeVis≥23GB）下直接成功**（~5 分钟、峰值 commit ~21GB、exit 0）——debug 构建的 OOM 是 commit 上限问题非物理内存问题，之前失败全是 metro/daemon/多 agent 并发挤占（已知问题#6）。页面文件与 WSL2 都**不是必需**；WSL2 linux64(Optimized) 路线保留为"拿不到空闲窗口"的降级（`release/wsl2-hermesc-test.md` 含全部实测与坑：16GB VM 帽、drvfs mmap 0 字节、rootfs 脏只读恢复序）。产物 mv 覆盖 `index.android.bundle`（复刻任务 moveTo 终态）→ touch marker → assembleRelease（bundle 任务 SKIPPED，bytecode 原样进包）。
3. **坑③ 内存分时**：见已知问题#6——hermesc 5 分钟窗口内 metro/daemon/vitest 全停，编排者广播窗口开始/结束。
4. **坑④ 日志形态**：gradle 必须 `--console=plain` + 重定向到文件（`paseo-go/release/build-attemptN.log`）。
5. **坑⑤ scheme 漂移（C13 实锤，根因=prebuild 时机 vs F8 改动顺序）**：F8 把壳 scheme 改在 `app.config.js`（native 面），但 `android/` 树是 F8 **之前**某次 `PASEO_GO=1` prebuild 的快照（applicationId=app.paseo.shell 为证）；此后所有构建（含 C13 首版 release）直接复用该树、未重跑 prebuild → 产物 manifest 恒为旧值 `paseo`，与官方/双 debug 包四重抢注深链（`pm dump` 可见）。手改 `android/app/src/main/AndroidManifest.xml` 只能当**验证手段**；**正式 APK 必须出自 `prebuild --clean` + phase0 补丁的完整链**（否则树-config 漂移仍在，下次 prebuild 静默回退）。发布前必查：`adb shell cmd package query-activities -a VIEW -d paseo://x` 不含 `app.paseo.shell`，且 `paseogo://chats` 冷启动直达壳对话页。
6. **定稿一键**：`PHASES="0 1 2 3 4" bash paseo-go/release/build-release-wsl.sh`（幂等可重入：0=重打补丁+桩；1=gradle export minified JS+记录 bundle sha；2=hermesc 原生/WSL2 降级+防呆断言(新鲜 bundle sha 一致+hbc mtime≥bundle)+header 校验+mv 就位；3=marker+assembleRelease 全链；4=清 marker+sha256 记录）。产物 `android\app\build\outputs\apk\release\app-release.apk`；**签名=debug keystore**（RN 模板 release `signingConfig signingConfigs.debug`，正式签名 TODO：换 keystore 后在 `android/keystore.properties` + 签名块替换，发布前必须做）。release 包 JS 为离线 bundle（不走 metro），装机即验证"无 metro 可用性"。
   6b. **坑⑥ prebuild 变体漂移（v0.2.0 实锤）**：android/ 树是 prebuild 快照——**debug 构建若跑过 `expo prebuild --clean`，会把 `.debug` 烙进树基 applicationId**（`android/app/build.gradle` 的 `applicationId 'app.paseo.shell.debug'` 是基值不是 suffix），此后 release 一键链**不重跑 prebuild** → assembleRelease 静默产出 `.debug` 包（adb install 报 Success 但 `pm path app.paseo.shell` 空、logcat 显示替换的是 debug 包）。**release 前必跑 production prebuild**（APP_VARIANT 不设+PASEO_GO=1，见上命令块）并核对 `grep applicationId android/app/build.gradle` = `app.paseo.shell`。
   6c. **坑⑦ WSL 可能整备消失（v0.2.0 实锤）**：`wsl.exe` 报"未安装"（特性被系统更新移除级）→ phase2 的 WSL2 降级路失效。原生 win64 hermesc 实测 **FreeVis≥20.4GB 即可成**（18.8GB OOM；脚本 23GB 门槛是保守值）——WSL 不可用时：`PHASES="0 1"` 脚本跑 → 手动 `hermesc.exe -w -emit-binary -out <gen>/index.android.bundle.hbc <gen>/index.android.bundle` → 手动跑 phase2 防呆三断言+mv → `PHASES="3 4"` 收尾。
   6d. **低电设备=不可信测试台（KI-11 二役实锤）**：MatePad 电量 <20% 且未真充电（dumpsys 无 ac/usb 位）时，
   > 3s 的 input 注入被电源管理静默丢、JS 长按计时链不触发、persist 可丢写、内核 hung_wp_screen wedge 需整机重启。
   > 测前必查 `dumpsys battery` 的 level+充电位；**PC USB 口不保证充电**，长测挂墙充。
   > 另：force-stop 重启 app 可能恢复到上次路由（会话屏）而非列表页——取证脚本第一步必须断言在目标页。
7. 版本/上游注入（M1 改口径）：`paseo-go/VERSION`=上游合流版本系（M1 起 `0.10.2-go.N`，跟上游稳定版走，供 M2/M3 消费）；壳展示版本=`src/shell/config.ts` `SHELL_VERSION` 常量（0.3.0 系，发布卡才动）——两套各管各，不再同步改；关于页 hash 来自 `EXPO_PUBLIC_PASEO_GO_UPSTREAM` 构建期内联（已证：sentinel 值 export 后 bundle 内恰 1 处命中、无运行时 process.env 查找；终验=关于页实拍）。

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
- ⚠（C20 实测；C33 popover 形态复验同值）**长按→(pending-open)窗→滑→拖接力链**的注入速度必须 **≤10px/s**（如 200px/20000ms）：180ms arm 判定时 JS 可见位移要 ≤4px、500ms 窗决策 ≤6px，metro 热/JS 快时 25px/s 即被误判成滚动（C20 33 号截图翻车实录）；置顶组内**向下拖**会被下拉刷新拦截，接力用**向上拖**。菜单转 popover 后此纪律不变（窗同为 MenuOverlay Modal，抬手才 materialize）。
- ⚠（C3 实测；**C13-F1 升级为根因级**）系统输入法（本机=百度）下 `adb input text`/`keyevent` 注入会被滑词/预测候选吞改：实测 `build`→`builder`→`builder部idbbuidb`，RN 受控 state 收到的是**被改后的文本**——C13 文件搜索"零命中回归"即此伪影（卡 C13-F1）。**自动化文本注入必须用 ADBKeyboard**：装 `C:\tmp\ADBKeyboard.apk`（senzhk/ADBKeyBoard）→ `ime enable/set com.android.adbkeyboard/.AdbIME` → tap 输入框 → `adb shell input text "…"`（无预测、逐字直提交，实测 debug/release 均可靠）；`am broadcast -a ADB_INPUT_TEXT` 在键盘未显示（`dumpsys input_method` mInputShown=false）时静默丢弃，勿用。给真人演示前记得切回系统输入法。
- **深链 scheme 分叉（REVIEW-FIX F8）**：壳包（`PASEO_GO=1`）scheme=`paseogo`，官方保持 `paseo`（`packages/app/app.config.js` 单行三元）。影响：① 官方配对链接从此只拉官方 app，壳的深链自持 `paseogo://`——旧 C14 恢复配方里的 `paseo://me` 在壳包上失效，写作 `paseogo://me`（该配方文本未入库，以本条为准）；② 双包共存时 `paseo://` 归官方，壳只能经 launcher / `am start -n app.paseo.shell[.debug]/…MainActivity` 或 `paseogo://` 拉起；③ 恶意深链面收窄见 F6：预览屏 workspaceRoot 参数不再压过 workspace descriptor（`src/shell/files/preview-root.ts` 有回归测试）。
- ⚠（C13 实锤）F8 之后**不跑 `prebuild --clean` 直接复用旧 `android/` 树构建 = scheme 漂移回 `paseo`**（首版 release APK 即中招：`pm dump app.paseo.shell` 只见 `paseo`，四 app 抢注深链弹选择器）。修法二选一：完整=§3.5 代码块含 prebuild 重跑全链；增量=手改 `android/app/src/main/AndroidManifest.xml` 的 `<data android:scheme>` 为 `paseogo` + touch marker + 重跑 phase3（JS bundle 不变，5-10 分钟）。发布前必查：`adb shell pm dump <pkg> | grep Scheme`。

## 5. 截图采集（对应证据契约 4）

```powershell
$ADB = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe"
& $ADB -s AHPEBB1826005071 exec-out screencap -p > C:\work\paseo-go\paseo-go\evidence\<卡号>\<名称>.png
```

规则：每卡 ≥2 张存 `paseo-go/evidence/<卡号>/`，Agent 必须亲自 read 每张并在报告写结论。
（注意平板可能横竖屏切换：screencap 原图尺寸以实际为准，uiautomator bounds 是**当前方向**的坐标系。）

## 6. M2 fork CI 全平台出包流水线（tag → Actions → Releases 唯一分发源）

**终态**：dev 仓 → `make-public-mirror.sh` 单向重放 → public 仓（Karl0007/paseo-go）打 tag → GitHub Actions（`.github/workflows/fork-release.yml`，fork 专属新文件=壳侧资产非上游触点）出全平台包 → Releases 为唯一分发/更新源。

### 6.1 触发与产物

- 触发 tag：`v*.*.*-go.*`（如 `v0.10.2-go.2`；VERSION 文件=上游线系列 `0.10.2-go.N`）。
- 产物：CLI tarball ×2（`getpaseo-cli-<ver>-linux-x64.tgz` / `-win32-x64.tgz`，**平台特定**）、shell APK（arm64-v8a）、desktop win（Setup exe + zip）、desktop linux（deb/rpm/AppImage/tar.gz）。mac 不出（无 Apple 凭据，release 说明已注明）。
- release 说明顶部=产物直链清单+每产物 sha256（latest 指针）；release 标 prerelease（deploy-website 的 `!prerelease` 守卫使其 release 事件自然 skip）。

### 6.2 CLI tarball 口径（为何不是裸 npm pack）

裸 `npm pack -w @getpaseo/cli` 的 tarball 里 `@getpaseo/{client,protocol,server,...}` 依赖会去 **公共 npm registry 拉上游 0.10.2**——fork 的 server 改动（188 文件）全丢。且 npm 11 拒绝 bundle workspace 链接依赖；半 bundle（只 bundle 壳包、外部依赖留给 registry）在 `npm i -g` 全局布局下**确定性失败**（嵌套 lifecycle 依赖 bin-link 缺失，win11/npm 11.6 复现两次）。定稿=`paseo-go/release/pack-cli-bundle.mjs`：7 个壳包 `npm pack` → 全新 staging `npm install --omit=dev <7 tgz>`（外部依赖走 registry、node-pty 按宿主平台出预编译产物）→ 整棵 production node_modules 以 `bundleDependencies` 全量 vendored 进最终包。**终用户 `npm i -g <url>.tgz` = 纯解包+bin 链接，零 registry、零脚本**；代价=tarball 平台特定（win-x64/linux-x64 各一，release 说明分列）。脚本内置三道防呆：fork 血统标记（server dist 里 fork-only 文件）、web-ui 导出探针、node-pty 原生模块探针。

### 6.3 APK 口径（CI 与本机 §3.5 的差异）

CI=ubuntu runner（JDK21+镜像自带 Android SDK，AGP 自动补组件）：`PASEO_GO=1 EXPO_PUBLIC_PASEO_GO_SHELL=1 EXPO_PUBLIC_PASEO_GO_UPSTREAM=<上游短sha> ENTRY_FILE=packages/app/index.ts` + 壳侧桩（§3.5 坑①同物，workflow 内联生成）+ `expo prebuild --clean` + `gradlew :app:assembleRelease`（arm64-v8a 单 ABI）。**linux hermesc=Optimized，§3.5 坑②(win64 debug OOM)整套不存在，无需 afterEvaluate 补丁/外部 hermesc/WSL**——本机一键链的 phase0-4 在 CI 全部不需要。prebuild 后断言 `applicationId 'app.paseo.shell'`（坑⑥漂移防线）。

**go.4-6 实锤：16GB 托管 runner 打不出本 APK**——`Assemble release APK` 三连被宿主驱逐（`The runner has received a shutdown signal`，均发生在 metro bundle 写完瞬间，java 6g + metro node 8g cap + linux hermesc 48MB bundle 编译三者叠加超 16GB 宿主压力；`gh run rerun --failed` 一次同点死）。go.6 的 APK=本机 `build-release-wsl.sh` 全链重打（见 RELEASE.md go.6 行）。CI 化下轮候选：**A**=NODE_OPTIONS 降 6144 + `-Dorg.gradle.workers.max=2` 压峰值；**B**=self-hosted runner（用户另一台 Linux 机，DEPLOY-NOTES 同规范）。

**go.6 新增 CI 事实**：镜像根来自 Windows tarball 快照 → 全仓文件 git mode=100644（无 100755），linux desktop 构建 EACCES on `resources/bin/paseo`——workflow 已在 linux job 内 `chmod +x packages/desktop/bin/paseo`、APK job `chmod +x gradlew`（CI 侧修，不动仓内文件）。CLI 打包顺序=上游 Dockerfile 证明过的依赖序（bare `npm ci` 无 workspace dist，cli 先 pack 必死 TS2307）。

**keystore 保管纪律**：签名=RN 模板 debug keystore（cert SHA-256 `fac61745dc…91033b9c`，与 M1 装机包同源=可 `-r` 升级）。⚠ 注意 `~/.android/debug.keystore` 是**另一把**（cert `5E8F…`），别混。保管三处：① public 仓 secret `PASEO_DEBUG_KEYSTORE`（base64，CI 写回 `android/app/debug.keystore`——gradle 模板 release 块本就指 `file('debug.keystore')`，**零 gradle 改动**）；② 本机副本 `C:/work/paseo-go-keystore/debug.keystore`（仓外，不入库）；③ 源头=prebuild 模板自带（`packages/app/android/app/debug.keystore`，android/ gitignored）。正式签名 keystore 仍是发布前待办（换 keystore 会断装机升级链，需配合卸载重装）。

### 6.4 上游 workflow 冲突处置（零触点原则）

上游 12 个 workflow 逐个核 triggers：与 `v*.*.*-go.*` 撞 tag 且缺凭据必红的 4 个——`android-apk-release.yml`(`EXPO_TOKEN`)、`deploy-app.yml`(`CLOUDFLARE_API_TOKEN`)、`desktop-release.yml`(`APPLE_*`)、`release-notes-sync.yml`(GITHUB_TOKEN 够用但会用 CHANGELOG 覆写我们的 release 说明)——在 **public 仓仓库级禁用**（`gh api -X PUT …/workflows/<id>/disable`，不改文件=不扩触点；禁用态是服务端属性，镜像 force-push 不复原）。第 5 个禁用=`docker.yml`：纯 GITHUB_TOKEN 本可用，但其 setup 断言 `package.json.version == tag去v`，与我们的 `0.10.2-go.N` 系列天然冲突（go.1-3 三轮 publish 全红实锤），不改上游文件只能禁。其余 7 个 trigger=main/PR/manual，镜像分支 `paseo-go/v0.1.0` 上天然休眠。安全面：public 仓非 owner 不能推 tag，secrets 只在 owner 推 tag 时可达；`allowed_actions=local` **未设**（会连 actions/checkout 一起禁掉，本仓 workflow 全瘫）。

### 6.5 镜像全量重建 runbook（本轮实测版）

`make-public-mirror.sh` 的 bash 路线在本机已不可依赖，两个环境级坑：

1. **PATH 里的 `bash` = `C:\Windows\system32\bash.exe`（WSL 残留 shim，坑⑦）**——任何 `bash xxx.sh` 直接弹"未安装发行版"。git-bash 在 `C:\Program Files\Git\bin\bash.exe`，或按本轮做法用 node 编排等价步骤。
2. **git 2.43.win 的 `format-patch --binary` + pathspec 组合静默产出空文件**（打印文件名、rc=0、文件不存在；node fs 实锤）。定稿=逐 commit `format-patch --binary -1`（无 pathspec）→ 文本层剥除 `paseo-go/evidence/` 段（剥完补 `-- ` 签名，否则 am 报 corrupt）。
3. 根提交=tarball 解包时 **`git archive` 产物无前缀目录**，不要 `--strip-components=1`；bsdtar 撞 symlink-vs-dir 报错可容忍（symlink 用 `git ls-tree db4fd334` 的 120000 条目写桩+`update-index --cacheinfo` 修 mode）；`git add -A` 必须带 `-f`（上游有被 ignore 但已跟踪的文件，如 `app.json` 样例）；`.gitignore` blob 上游存的是 CRLF，add 会被 `core.autocrlf=input`(全局) 归一成 LF——最终树对账前用 `cat-file blob` 原字节回写+amend。
4. **树对账（必做，空=过）**：`git fetch <mirror> +HEAD:refs/mirror-check && git diff --stat HEAD refs/mirror-check -- . ':(exclude)paseo-go/evidence'` 必须零输出（本轮 `v0.10.2-go.2` 时=EMPTY）。
5. 增量同步（修 workflow 后重出包）：`format-patch -1 HEAD` → 镜像 `git am` → `push --force` 分支 → 删旧 tag 重打 `go.N+1`（Actions 不重跑已失败 tag）。

### 6.6 出包→换装→任务重启 全链

1. 出包：dev 仓提交 → 镜像重建/增量（§6.5）→ `git tag v0.10.2-go.N && git push origin <tag>` → `gh run watch`（public 仓）。
2. 换装：CLI=本机 `npm i -g --prefix <测试前缀> <win32 tarball>` → `paseo --version` 应为 `<ver>` → 隔离 `PASEO_HOME`+config.json `daemon.listen` 指第三端口 → `daemon start/stop`；APK=`adb -s 192.168.31.14:5555 install -r <apk>`（签名同源可直接覆盖）→ 冷启三 tab；win zip=解包+清单核对（本机禁忌#1 不实跑）。
3. 任务重启：新包验证过 → RELEASE.md 记 go.N 行（产物 sha256+run 链接）→ 后续任务按新成品包口径验收。

## 7. M4 客户端更新仪式（CLI 升级 + 更新指向 fork Releases）

### 7.1 CLI 升级仪式（fork Releases=唯一分发源；生产切换/回滚细则见 `~/.paseo/DEPLOY-NOTES.md`，它是生产真相，M3 维护其升级仪式 diff，本节不重复）

1. 看最新指针：`gh release list -R Karl0007/paseo-go`（M2 口径：**最新 release 即最新成品包**，body=全产物直链+sha256 清单）。
2. 装：win `npm i -g https://github.com/Karl0007/paseo-go/releases/download/<tag>/getpaseo-cli-<ver>-win32-x64.tgz`；linux 同形换 `linux-x64`。tarball 全量 vendored——不访问 registry、不跑编译脚本（§6.2）。
3. 验：`paseo --version` = `<ver>`（tag 去 `v`）。
4. 重启任务：`Stop-ScheduledTask PaseoDaemon` → `Start-ScheduledTask PaseoDaemon`（dev 形态=daemon stop/start）；生产按 DEPLOY-NOTES 自检四条执行。
5. 回滚=同法装上一版 tarball 再重启任务。

### 7.2 更新指向落地口径（M4）

- **desktop**：`packages/desktop/electron-builder.yml` publish `owner/repo=Karl0007/paseo-go`（上游触点 `COMPAT(paseoGoUpdateFeed)`，申报制；fork-release.yml 出包时另按仓库上下文覆盖，两处同源）。⚠ 实测定口径：我们的 release 是 **prerelease**，electron-updater stable 通道 `allowPrerelease=false` 不认（`src/features/auto-updater.ts`）——desktop 自动更新要真正触发，需 release job 去掉 `--prerelease`（fork-release.yml 一行）或用户在应用内把通道切 beta。本轮未改（禁忌#1：desktop 不装不跑，改了也无本机证据链）。
- **壳 APK**：启动探一次 + 设置页手动强拉 `GET /repos/Karl0007/paseo-go/releases?per_page=1`（实测 `/releases/latest` 对 prerelease-only 仓 404，故用 list 首条）；比对 `0.10.x-go.N` go 线（`src/shell/update/versions.ts` 段内数值序，go.10>go.9）。当前版本=构建期盖章 `EXPO_PUBLIC_PASEO_GO_VERSION`（CI apk job 注 tag；本地 `release/build-release-wsl.sh` 默认读 `paseo-go/VERSION`；`shell/config.ts` 字面兜底=最后发布线，**发版仪式随 tag bump**）。新则一次性提示条（可关、同版本 store 标记只提示一次、点击落 release 页）。
- **测试钩**：metro 起时 `EXPO_PUBLIC_PASEO_GO_UPDATE_FEED=http://<PC_IP>:8099/fake.json` 把 feed 指到本地 mock（形状=GitHub releases 列表数组，`[{tag_name,html_url}]`，见 `src/shell/update/feed.test.ts` 契约）；产品常量零假数据。
- **验证级别（如实记）**：无第二台测试机，desktop 端到端更新链未实跑（代码审+config-parse 单测代证，卡验收允许）；壳侧状态机/版本比对/feed 契约=单测钉住（update 域 36 例）。

## 已知问题 / 边界

1. 上表 4 个环境性测试失败（zh-CN locale x3、CRLF x1、forges 测试 Windows 路径 bug x1）——Linux CI 全绿，本机不修（`packages/` 铁律禁改）。
2. 本机页面文件禁用是 gradle/vitest OOM 根因；长期建议用户启用页面文件（系统属性→高级→虚拟内存），启用后可去掉 §2/§3 的限内存参数。
3. `expo run:android` 一键路径在默认内存参数下会死，故 runbook 固化为 prebuild+gradle 分步。
4. EAS 完全不需要：本地 gradle 路径零登录。
5. **聚合连接状态 hook 在 React Compiler 下失效（R1，归类 c）**：官方 `useHostRuntimeConnectionStatuses` 的 `void version` 重算信号会被 `app.config.js` 的 `reactCompiler: true` 剥掉，返回的 Map 只在 serverIds 身份变化时刷新（真机表现：在线 host 永久显示"连接中"）。壳屏必须用 `src/shell/runtime/use-shell-host-statuses.ts`；根因与上游复现见 `paseo-go/R1-upstream-repro.md`。另：给 app 拉新 bundle 后需 force-stop+重启 app（metro 终端 `r` 键经管道不可靠）。
6. **构建/常驻服务严格分时（C13 实锤）**：metro 或 gradle release 与双 daemon 并发 = 内存死区（页面文件禁用机，commit 上限≈物理内存）。实测连锁：metro GC 死亡螺旋（6.8GB commit）→ gradle 的 export:embed 子进程被挤到死（表现为进度条假死 40 分钟）→ metro 自己随后 exit 134 → 双 daemon 也会被 OOM 带走。纪律：**构建期只留构建进程（先停 metro+daemon），冒烟期再起 daemon，二者严格分时**；gradle 子进程死锁排查法见 §3.5 坑④。hermesc 修正结论：debug 版 win64 hermesc 的 OOM 是 **commit 上限问题而非物理内存/页面文件问题**——整机空闲（FreeVis≥23GB）即可 5 分钟编完（§3.5 坑②），页面文件只是让并发容忍度变高的建议项，不是发布前置。
7. **metro 在跑时 app typecheck 会被 typed-routes 污染（C17 批次二实锤）**：dev metro 以 workspace 根为 server root，expo-router 类型生成把全仓 `*.test.ts` 当路由扫进 `packages/app/.expo/types/router.d.ts`（实测 798 个 pathname 字面量）→ 仓根 `npm run typecheck` 在 app 包报 TS2590（与任何卡改动无关）。**提交口径**：`rm packages/app/.expo/types/router.d.ts` 后立刻 commit（钩子 typecheck ~18s < 重生成 ~70s 窗口）。根治候选（未验证，勿在批次中途试）：metro 重启带 `EXPO_USE_METRO_WORKSPACE_ROOT=0`（需回归 dev bundle 可用性）或 typedRoutes 实验开关——后者动 app.config.js 缝隙文件，禁。**dev metro 堆帽（C27 实锤）**：宽屏/多路由图冷编译（files 路由 ~4100 模块）可把默认 node 堆顶进 GC 死亡螺旋（WS 4.7-4.9GB、CPU 满载、设备 bundle timeout）——**metro 一律带 `NODE_OPTIONS=--max-old-space-size=8192` 起**（restart 不带 `--clear` 保 transform 磁盘缓存，冷队列首请求超时重试一次即可）。
8. **Windows 盘符大小写纪律（C17 批次二实锤，两处同源）**：一切命令/`hub start` 的 cwd 必须写**大写盘符** `C:/work/paseo-go/...`。小写 `c:/` 起 metro → projectRoot 小写而 `node_modules/@getpaseo/*` symlink realpath 大写 → metro 判定符号链接目标出界，**所有工作包解析失败**（bundle 500 `Unable to resolve module @getpaseo/highlight`）；小写 `c:/` 跑 vitest → @vitest/runner 双实例化，每文件 0 test + `Cannot read properties of undefined (reading 'config')`，全仓看似崩实为盘符。W1 stash 对照同此口径。
9. **autocrlf×oxfmt×lefthook 提交坑（C25 发现，C27 补全机制）**：`core.autocrlf=true` 使检出 `.ts` 为 CRLF 而 oxfmt 要 LF → 既有 CRLF 文件可把 pre-commit format 钩子带红。**完整机制（C27 实锤）**：lefthook 的 stash/restore 周期会把 **MM 态文件（staged+unstaged 并存）**的工作树按 autocrlf 重写成 CRLF——钩子检查的是工作树路径，于是**怎么 oxfmt 都修不好**（写完又被 stash 还原成 CRLF）。**安全姿势**：将提交文件全部 `git add` 到工作树==索引（LF）→ `npx oxfmt <files>` → `git config core.autocrlf false` → commit → 恢复 true。另：`git checkout -- <file>` 在 autocrlf 下写出 CRLF，别拿它当"恢复 LF"用。**⚠ M1 起口径变更（2026-09-30 实锤升级）**：上游 merge 大面积撞此坑，仓已置 **repo-local `core.autocrlf=false` 永久制**——上述"→恢复 true"步骤**作废**，任何进程再把 autocrlf 设回 true 都会复发（工作树已 LF 重物化，blobs 未动）。禁整仓跑 oxfmt（churn 全仓）。编辑工具落盘即 LF 且保持整文件 staged 的卡不受影响。
10. **语音=OpenAI 兼容 provider 面（C28）**：local 模型下载路径（GitHub fetch failed 冻结态/无代理/无中文模型）整体绕开——dev daemon `.dev/paseo-home/config.json` 已配 `features.dictation.stt.provider=openai` + `features.voiceMode.stt/tts.provider=openai` + `providers.openai.stt/tts.apiKey="dummy"` + baseUrl 占位（就绪态不探测端点，占位安全；dev-daemon.sh 恒 export 的 `PASEO_LOCAL_MODELS_DIR` 使 local turn-detection worker 保留）。真机 toast 消失、录音态可进；端到端转写待用户自部署端点，**部署规格/验收 curl/回执格式=`paseo-go/VOICE-DEPLOY.md`**。
11. **devd 无源码热重载（C23C25 波实锤）**：`scripts/dev-daemon.sh` 的 supervisor 只在崩溃后重启——**改了 `packages/server`/`packages/protocol` 后必须 `hub restart devd` 才生效**（首启编译 watch 链需 30-60s，别把启动慢误判为 provider 缺失）；改 config.json 同理。涉 daemon 的卡验收前先断言运行代码=HEAD（如 list_available_providers / 新字段探针）。**⚠ restart 必须带完整 launch spec（含 `PASEO_HOME=C:/work/paseo-go/.dev/paseo-home` 前缀）**——裸重启会继承 shell 环境指向用户 `~/.paseo`（C26 实锤：幸被单实例锁挡下）；重启后在 hub logs 里核对 `Home:` 行与 `daemon-keypair.json` 路径=.dev 才算安全。**⚠ registry 磁盘手改纪律（CloseDev4 实锤）**：devd 运行中直接改 `workspaces.json`/agents 的 `archivedAt` 会被 daemon 下一次 registry 写覆盖——恢复/取证改盘必须"先改盘 → `hub restart devd`"，中间禁跑任何写 registry 的 CLI（第一轮恢复曾被冲掉）。
