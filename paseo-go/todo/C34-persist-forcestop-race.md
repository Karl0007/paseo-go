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
