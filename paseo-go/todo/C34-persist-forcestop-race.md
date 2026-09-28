# C34 调查：zustand persist 写入 × force-stop 竞态（收藏/指令偶发丢失）

## 现象（用户可见后果）

C19 真机轮观察（known_issues#2 移交）：4:02 收藏的 AGENTS.md 与 4:06 创建的指令 C19-probe，在 `adb am force-stop` 重启后**丢失**；更早（4:0x 之前）的 CLAUDE.md 收藏仍在。若复现属实=用户日常杀 app 会丢收藏/快捷指令——P1 级数据丢失；也可能是观察窗口巧合（写入其实已落盘，丢失另有因）。P2 立案，复现后升级。

## 根因候选（逐一定性，禁猜测定案）

1. zustand persist 异步写 AsyncStorage 与 force-stop 竞态（写未 flush 进程死）。
2. metro 开发态 JS 线程被 metro 重启打断，persist 未执行（dev-only，release 无 metro）——**必须区分 dev/release 行为**，否则误判严重度。
3. AsyncStorage(64MB 配置插件) 写失败静默。
4. C19 观察误差（创建/收藏实际未成功——回看其截图 07/10 时刻状态）。

## 修复方向

复现→定位→按根因修（候选姿势：写后立即回读校验/关键动作后 `persist.flush?`——以 zustand 版本实际 API 为准；禁无证据加"防抖持久化"）。若定性为 dev-only，写 BUILD.md 纪律并降级 known_issue。

## 验收

1. 复现脚本/步骤（debug+metro 与 release 包各一轮：收藏→立即 force-stop→重启→断言；收藏→等 10s→force-stop→断言）。
2. 定性结论=四候选之一+证据链（AsyncStorage 落盘时间线 vs force-stop 时刻）。
3. 若修：favorites/commands/readState/pins/settings 全 store 一致处置+回归测试；真机两轮通过。
4. 恰好一次 commit（或纯调查卡=文档 commit）。

## 范围

- 动：`src/shell/stores/**`（如需）+ 新测试；`src/shell/**` 消费方仅接线级
- 不动：官方 AsyncStorage 封装/插件

## 设备波 debug 轮（2026-09-27，metro@8081 + `app.paseo.shell.debug`，设备 AHPEBB1826005071）

**结论先行：C19 原始观察被磁盘真相证伪 → c4 定案；c3 排除；c2 无实证；c1（毫秒窗口）未裁决——18 样本矩阵未跑完（0/18），窗口被自动化基建稳定性消耗。**

### 磁盘真相（run-as 导出 `databases/RKStorage`，node:sqlite 查 `catalystLocalStorage`；原件行导出存 `evidence/C34/RKStorage-extract.txt`）

- `paseoGo.commands`：`C19-probe` 在盘，`createdAt=1790453073516` = **2026-09-27 04:04:33 本地**——与卡面「4:06 创建的指令 C19-probe」同分钟窗，即**原件**（prompt="ping"，id=cmd-4026ee69…）。它今日上午 UI 实测渲染在案（工作区 tab dump）。→ 指令侧「force-stop 后丢失」不成立：写入落盘且跨多次 force-stop 存活。
- `paseoGo.favorites`：仅 `AGENTS.md` 一条，`addedAt=1790372699580` = **2026-09-26 05:44:59 本地**（早于 C19 真机轮一天；addFavorite 重收藏会刷新 addedAt，故这是最后一次收藏写入）。它扛过了 C20–C33 各设备波的反复 force-stop。卡面「4:02 收藏的 AGENTS.md 丢失」与此矛盾：要么 4:02 那次收藏动作本身没发生（C19 误读，看到的行就是这条 09-26 的旧行），要么观察窗错位。卡面「更早的 CLAUDE.md 收藏仍在」则已不在盘（后被主动移除）——C19 观察的两个数据点与盘面对不上号。
- 定性：**c4（C19 观察误差）定案**；**c3（AsyncStorage 静默写失败）排除**（两条写入均完整在盘、schema 完好）；**c2（metro/dev 打断 persist）**无实证——本轮观察到的 dev 不稳定性表现为 bundle 拉取挂起（app 起不来），不是写丢失。

### 矩阵状态：0/18（基建就绪，移交下一窗口）

- 全链彩排通过（非计数样本）：文件行→预览→返回→选择胶囊「收藏→取消收藏」content-desc 翻转（内存态断言）→工作区 `shell-favorite-row-…` 行渲染→长按菜单取消收藏；指令表单 ADBKeyboard 注入→`text=` 回读断言→保存→`shell-command-row-` 渲染→长按删除→**确认弹窗**。彩排残留已清理（notes.md 收藏、rehearsal 指令均已删）。
- 探针已备：`C:/tmp/c5-proj/C34-fav-{A1..A3,B1..B3}-1790486644.md`；指令探针名现生成。
- 脚本（`evidence/C34/`，git-bash 直接 source）：`lib.sh`（T1-T5 全内建）+ `fav_sample.sh <tag> <A|B> <file>` + `cmd_sample.sh <tag> <A|B> <name>` + `sqlq.js` + `cleanup.sh`。单样本 ≈4 分钟（两次冷启为主），18 样本 ≈75 分钟。
- 本轮消耗在冷启/断言基建的三个坑（全部已修进 lib.sh，下一窗口勿重踩）：
  1. **`uiautomator dump` 不带 `--compressed` 在 RN 忙帧时直接挂死 ≥55s**（C19 后新踩实锤）；改 `exec-out uiautomator dump --compressed /dev/tty` + `timeout 10` 单次。
  2. **dev-launcher 初始化未就绪时点 URL 行会被吞**（app 静默停在 launcher，日志假死）；冷启后 ≥12s 再点，nomatch≥10 自动 relaunch。
  3. **模态（确认删除 sheet）会顶掉整棵 dump 树**——断言「行消失」会被弹窗窗口伪装成 TRUE；删除必须点完菜单项后再点「删除」确认。另：tablet keep-alive 可能复制节点，tap 一律取最大面积 bounds。
- 判读口径不变：A挂B过=c1 成立；A/B 均过=c1 也降级「未复现」（在 c4 已定案基础上把 known_issue 转「观察误差，竞态未证实」）；A/B 均挂=查 RKStorage items 区分「从未写入」vs「hydration 覆盖」。
- 附加样本（启动期 hydration 前写守卫）：维持分析轮口径——A/B 全过则仅记纪律不修（`commands/edit.tsx:442-444` 的 seed-waits-hydration 姿势已是现成守卫参照）。

## 脚本唯一出处（FIX-C R2-26 证据卫生，2026-09-27）

本卡旧复现草案 `todo/C34-repro-draft.sh` 已删除：它的 `dump()` 不带 `--compressed`（=上面坑①，RN 忙帧挂死 ≥55s），`tap_id` 也不取最大面积 bounds（=坑③，tablet keep-alive 复制节点）——按它跑必重踩三个已实锤坑。**唯一可用出处 = `evidence/C34/`**（`lib.sh` T1-T5 全内建 + `fav_sample.sh`/`cmd_sample.sh`/`sqlq.js`/`cleanup.sh`，见「矩阵状态」节）。

## CLOSE-DEV1 设备窗口（2026-09-27 深夜）：矩阵仍未跑（0/18），c1 维持「未裁决」

- 窗口被两件事消耗：① **metro 僵尸化**——旧 metro 进程 WS 12.4GB（8GB 堆帽下 GC 死亡螺旋，KI#7 形态），`/status` 200 但 `/` 与 bundle 请求全挂、设备端三次「Error loading app timeout」；按 launch spec 重启（大写盘符 cwd + `NODE_OPTIONS=--max-old-space-size=8192`，不带 `--clear`），curl 预热 bundle（52.9MB/166s）后设备 12s 进首页。② 复验优先级（R2-01/05/10 + C35）先行，剩余预算不足以开 75 分钟矩阵。
- **lib.sh 本轮修掉四个基建坑（下一窗口直接受益，全部实锤）**：
  1. `pick_bounds` 的 `< <(...)` 进程替换在**后台任务里挂死**（dump 成功、pick 永不返回；前台正常）→ 改临时文件喂 while。
  2. `disk_truth` 被 fav/cmd_sample 调用但**从未定义**（矩阵样本会丢磁盘真相导出）→ 补 `run-as cat databases/RKStorage` 导出到 `/tmp/c34/RKStorage-$tag.db`（node:sqlite 可读，实测 802KB 导出+查询全绿）。
  3. `cold_start` 点 launcher URL 行点的是**文本节点中心**（被行吞掉，app 静默留 launcher=坑②的加重形态）→ 改点行中心 x=800；修后冷启 53s 进首页实录。
  4. 脚本日志经 `{ }>file` 块重定向在进程被杀时**整块丢失**（stdio 缓冲）→ 改逐行 `>>` 追加。
- 判读口径、探针文件（`C:/tmp/c5-proj/C34-fav-{A1..A3,B1..B3}-1790486644.md`）、cmd 探针命名（`C34cmd<tag>X`）不变；A/B 全过=c1 转「竞态未证实」。
- 另：本窗口 `adb logcat -c`（不带 `-b`）在华为机上会挂死 ≥90s，用 `timeout 8 adb logcat -c -b main -b crash`。

## CLOSE-DEV2 设备窗口（2026-09-28 凌晨）：矩阵被裁决让位（0/18），c1 维持「未裁决」；基建再修两坑 + tight-window 附加样本脚本落位

- **中止裁决（Main）**：FIX-B 两批在途持续改 `packages/app/src/shell/**`（工作树 15 个 M 文件），debug 包每次冷启拉活 bundle → 工作区 tab 红屏 `Property 'SHELL_I18N_NAMESPACE' doesn't exist`（Render Error，Call Stack 15 frames）。**归因=兄弟在途态被打包，非 persist 链**：`i18n.ts` 源文件干净未改；兄弟 `validated-persist-storage.ts` diff 只动读侧与拒绝路径（getItem 解析失败保留原文不再 removeItem、setItem schema 拒绝改为跳写保旧值），正常写链 `backingStorage.setItem(JSON.stringify(...))` 逐字未动 → 矩阵测量对象仍有效，shell 冻结后可直接跑。矩阵排设备窗口三。
- **lib.sh 再修两枚基建雷（全部实锤，症状=冷启全 dumpfail 循环 / ABORT wt row 空转）**：
  1. **GNU `timeout` 不能 exec shell 函数**：`dump()/dump1()` 里 `timeout 12 adb_ ...` 在 Git Bash 子进程 127（`adb_` 是函数；本会话工具 shell 的混合 timeout 能执行函数，彩排绿不可迁移）→ 改直调 `timeout 12 "$ADB" -s "$SER" exec-out ...`。
  2. **`pick_bounds` 的 `local bx` 未初始化**在 `set -u` 下无匹配分支炸 `bx: unbound variable` → `local best=0 bx="" tmpf`。
- **环境对齐（新坑，窗口三必读）**：本会话 shell `/tmp`=`C:\tmp`；Git Bash `/tmp`=`%TEMP%`；PATH 上的 `bash`=WSL 启动器。已建 junction `%TEMP%\c34` → `C:\tmp\c34`（丢失重建：`powershell New-Item -ItemType Junction -Path $env:TEMP\c34 -Target C:\tmp\c34`），使 Git Bash 重定向与 node 的 `/tmp/...` 参数解析同目录。`matrix2.sh` 内建 PATH/LOCALAPPDATA/TMP 消毒（hub 子进程继承会话 mangled PATH，coreutils 全缺）。
- **新 harness（窗口三直接用）**：矩阵 18=12 核心（fav A/B×3 + cmd A/B×3）+ 6 附加（=卡面「附加样本」A×3+B×3）。附加样本脚本 `hyb_sample.sh`=**tight ≤1s 窗**：收藏 tap→立即 kill（中间无 dump/stat——既有 fav/cmd Round A 实际在变异后 2-4s 才杀，测不到 c1 的毫秒窗，此脚本补上；Round B=同流程+10s 对照；mem=-1，disk_ui+disk_sql 裁决）。`matrix2.sh`=18 样本编排（tag 前缀 fav-/cmd-/hyb- 防 ev/ 与 RKStorage 导出互覆）；`reset2.sh`=12 收藏+6 指令清场包装。附加探针 `C:/tmp/c5-proj/C34-fav-T{A1..A3,B1..B3}-1790530078.md` 已备。
- **冷启复核**：54-65s 进首页（metro 温热、URL 行 tap 后 bundle 30s）——基建就绪，只欠 shell 冻结窗。
- **设备复位**：三次中止均止于变异前，磁盘真相=基线（favorites=[AGENTS.md]、commands=[C19-probe]、pins 未动，零 C34 探针）；IME 已切回百度；app 留 home。c1 终笔判读移交窗口三。

## CLOSE-DEV3 设备窗口（2026-09-28 凌晨）：矩阵仍未跑（0/18），c1 维持「未裁决」

- 窗口预算被两件事消耗：① metro 僵尸化（私有 12.6GB，KI#7 形态；按批准 spec 重启+设备侧首包 46-83s 重建，冷启 54s 基线复现）；② FIX-B 复验 item 7（L2 风险闸）设备面 FAIL 引发误归档主 worktree 事故与恢复（详见 REVIEW2-INDEX CLOSE-DEV3 记录节）。矩阵未开跑即触达预算上限。
- 基建复核：junction %TEMP%\c34→C:\tmp\c34 在位、matrix2.sh/reset2.sh/探针文件未动、`env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD` 前缀对 devd 全 CLI 操作必需（否则 CLI 以本会话 agent 身份打 devd 报 Caller not found——即卡面 ⚠ 的解）。判读口径不变；移交下一窗口。

## CLOSE-DEV4 设备窗口（2026-09-28 凌晨，HEAD=18174591 代码冻结）：矩阵 18/18 跑完 → **c1 终笔=竞态未证实**

- **18/18 rc=0**（12 核心 = `matrix2.sh` 一遍过；6 tight 附加 = 修好基建坑后 `hyb_run.sh` 重跑）。产物：`evidence/C34/matrix-run3/`（`ledger.jsonl` 18 行 + `log-matrix2-run3.txt` + `log-hyb-run3.txt` + 39 件断言帧）。
- 核心 12（fav A1-A3/B1-B3、cmd A1-A3/B1-B3）：`mem=1 disk_ui=1 disk_sql=1` 11/12；dt_kill A 轮 fav 3.35-3.59s / cmd 6.03-6.54s，B 轮 14.0-16.3s。唯一例外 **cmd-B1 = mem=1 disk_ui=0 disk_sql=1**。
- 附加 6（tight ≤1s 窗，`hyb_sample.sh`）：**dt_kill = 384 / 387 / 422ms（A 轮）与 10468 / 10475 / 10544ms（B 轮），`disk_sql=1` 6/6**；`mem=-1` 是该脚本设计（内存断言前就杀，只测磁盘）。唯一例外 **hyb-A1 disk_ui=0 / disk_sql=1**。
- **判读（沿用卡面口径）**：A 轮=变异后 ≤1s 即 force-stop，6/6 全部落盘 → 不存在「persist 未 flush 进程已死」；A/B 均过 → **c1 降级「竞态未证实」**。叠加 c4（C19 观察误差）定案、c3 排除、c2 无实证 → **C34 终笔结论=观察误差，不是数据丢失缺陷**；known_issue 文案转「观察误差，竞态未证实」。附加样本（启动期 hydration 前写守卫）按卡面裁定**仅记纪律不修**（现成守卫参照 `commands/edit.tsx:442-444` 的 seed-waits-hydration 姿势）。
- 两处 `disk_ui=0`（cmd-B1、hyb-A1）定性：磁盘真相在盘（`disk_sql=1`）而重启后 UI 断言未命中该行；断言跑在冷启后首轮列表 hydration 窗内、且列表当时已累积 6 fav + 6 cmd 探针行 → 判为**观测面**（渲染时序/行位置），不属 persist 链。若日后要追「已落盘但列表不显示」，那是另一条链（与 R2-19「已归档再隐藏」语义相邻），不在本卡。
- **本轮就地修掉三枚矩阵基建坑（`evidence/C34/` 唯一出处纪律不变；脚本在 `C:/tmp/c34/`，与 evidence 目录同源）**：
  1. `fav_sample.sh`/`hyb_sample.sh` 的 `WT` 行 id 写成 `…:wt:c:C:/tmp/c5-proj`（大写盘符），而壳的 worktree 行 identity 经 `normalizeWorkspacePath` **把盘符小写** → 永不匹配，矩阵首跑 12 核心全 `ABORT wt row`(rc=3)。改 `c:` 后 fav-A1 立即 rc=0。
  2. **L1/L2 行是虚拟化的**：跑满 12 核心样本后（6 收藏行 + 6 指令行）c5-proj 项目行被顶出渲染窗，hyb-A1..B1 连 `ABORT wt row`。`lib.sh` 新增 `reveal_wt <PROJ> <WT>`：项目行不在树里就 `swipe 800,1900→800,800` 下滚重试、在就点开 → hyb 6 样本「REVEAL wt row after 3 try(ies)」全绿。
  3. `reset2.sh`→`cleanup.sh` 用 **650ms** 长按删指令：行菜单不 materialize（6/6 `DEL MENU FAIL`，fav 侧同坑 1/6）；popover 时代实测要 **1000ms**（与 C20/C33 注入速度纪律同源）→ 另落 `cleanup_cmds.sh`（1000ms 长按 + 再点「删除」确认，模态顶树纪律不变）。
- 设备复位：12 fav 核心探针 + 6 hyb fav 探针 + 6 cmd 探针全部经 UI 删除，磁盘真相回基线（`paseoGo.favorites=[AGENTS.md]`、`paseoGo.commands=[C19-probe]`，run-as 导出 RKStorage + node:sqlite 复核）；IME 切回百度、rotation 0、壳 ON、app 留 home（`mResumedActivity=app.paseo.shell.debug/.MainActivity`）。
- **编排失误如实记录**：清场脚本 `cleanup_fav_t.sh` 被我在 `hyb-B2/B3` 仍在跑时启动（设备争用），它因此对 TB1-3 报 `no-fav`（当时尚未创建），并出现 `FAIL tap_desc: 工作区`；两枚受影响样本仍 rc=0 且 `disk_sql=1`（判读依赖磁盘真相 + dt_kill 384-10544ms，结论不受影响），TB1-3 由后续单独一遍（1000ms 长按）删除并复验 favrows=1。纪律补一条：**矩阵在跑时不得并行任何设备侧脚本**。

## C34 release 轮（2026-09-28 上午，`app.paseo.shell` v0.2.0 离线 bundle，metro 已停，设备 AHPEBB1826005071）：8/8 → **c1 终笔=竞态未证实（debug 18/18 + release 8/8 完整）**

- **口径**：release 非 debuggable → `run-as` 不可用，磁盘真相 SQL 面不可达 → **release 轮=UI 断言**（ledger 逐行 `disk_sql=-1` 如实记）；Round A=变异 tap 后 ≤1s 即 force-stop（`mem=-1` 设计使然，同 debug 轮 hyb 姿势），Round B=变异→内存断言→等 10s→杀。冷启基线 **11s 进首页**（16 次冷启全 11s，无 metro 无 launcher 步；vs debug 轮 53-65s）。
- **8 样本（`evidence/C34/matrix-release/ledger.jsonl`，全 rc=0）**：

  | 样本   | 轮  | 探针                     | dt_kill | mem | disk_ui |
  | ------ | --- | ------------------------ | ------- | --- | ------- |
  | fav-A1 | A   | C34-fav-A1-1790486644.md | 343ms   | -1  | 1       |
  | fav-A2 | A   | C34-fav-A2-1790486644.md | 353ms   | -1  | 1       |
  | fav-B1 | B   | C34-fav-B1-1790486644.md | 13649ms | 1   | 1       |
  | fav-B2 | B   | C34-fav-B2-1790486644.md | 13071ms | 1   | 1       |
  | cmd-A1 | A   | C34relA1X                | 321ms   | -1  | 1       |
  | cmd-A2 | A   | C34relA2X                | 384ms   | -1  | 1       |
  | cmd-B1 | B   | C34relB1X                | 15572ms | 1   | 1       |
  | cmd-B2 | B   | C34relB2X                | 15303ms | 1   | 1       |

- **判读（并入 debug 轮总判）**：A 轮变异后 **321-384ms** 即杀（真 ≤1s 窗，比 debug 核心轮的 3.3-6.5s 更紧），收藏/指令 4/4 冷启后 UI 在；B 轮 4/4 在且杀前内存态已翻转（mem=1）。release 形态（离线 bundle、无 metro、JS 线程无外部打断）同样不存在「persist 未 flush 进程已死」→ 叠加 CLOSE-DEV4 debug 18/18，**c1 终笔=竞态未证实，C34 终笔=观察误差（c4 定案），known_issue 文案「观察误差，竞态未证实」维持不变**。无样本丢失、无功能损坏（0 FAIL）。
- **release 轮新踩三坑（全部实锤，脚本唯一出处 `evidence/C34/matrix-release/`）**：
  1. **worktree 行 id 整条小写**：v0.2.0 壳 dump 实测 `shell-workspace-worktree-srv_…:wt:c:c:/tmp/c5-proj`（`c:` 小写盘符），debug 轮 harness 的 `…:wt:c:C:/…` 在此包永不匹配 → 首跑 fav-A1 `ABORT wt row`。文件页头部同样显示 `c:/tmp/c5-proj`（normalizeWorkspacePath 全路径小写形态）。
  2. **Baidu IME 吞 `input text`**（C13F1 家族复现）：首跑 cmd 4/4 `ABORT name field text mismatch`（name 字段回读为空=变异未发生，release 轮把该断言改成硬 ABORT 是对的）。切 `com.android.adbkeyboard/.AdbIME` 后 `input text` 直落字段，trap 恢复原 IME → 重跑 4/4 `name_ok=1`。
  3. **横屏 2560×1600 左 rail 形态**：debug 轮滚动坐标 `800,1800/1900→800,800/900` 在此形态 y 越界无效 → 改列表列 `(530,1300)→(530,500)`。
  4. （清场附加）**删除确认必须点 `android:id/button1`**：`tap_text "删除"` 在弹窗未 materialize 时会点回同名菜单项（弹窗悬挂污染后续断言，首版 cleanup 因此错删 A2X 行）；且虚拟化裁切行无 `text=` 子节点，行定位要用 `content-desc="NAME · …"`。修正版 `cleanup_rel.sh` 重跑幂等绿（favrows=0 cmdrows=0 left=0）。
- **现场清与复位**：4 收藏+4 指令探针全部 UI 删除，release 基线回「收藏夹空态+无指令行」（release 数据与 debug 包隔离，基线本就空）；rotation 0、IME 百度、release 留 home（`mCurrentFocus=app.paseo.shell/…MainActivity`）。
- **附：release 冒烟补帧（同窗口）**：三 tab + 版本 + 工作区树 + 文件页 + 深链共 7 帧入 `evidence/RELEASE-020/`（00-chats/01-me/02-version 复用 .dev rel-020 实拍，03/04/05 本窗口补拍）。深链 `am start -a VIEW -d paseogo://chats`：**弹双包选择器（Paseo Go / Paseo Go Debug）——debug 包共存所致，如实记录**（`05-deeplink-chooser.png`）；选 Paseo Go·仅此一次后直落 release 包对话 tab（`05-deeplink-chats.png`，`mResumedActivity=app.paseo.shell/.MainActivity`），与 ACCEPTANCE §14.13「F2 双包选择器=非缺陷记录」口径一致。
