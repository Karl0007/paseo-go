## 生产升级补记（go.7→go.8，2026-10-02）

- 供应链：Releases win32 tarball 162,504,649 B，sha256=`850d170a…389917` ≡ body 表（首程 curl 被 1800s 作业期限截停于 ~64MB，`-C - --retry` 断点续传补全后 Get-FileHash 过；**sha 不符绝不安装**的闸门在切换脚本内置并生效——脚本正是停在 `SHA OK` 之后）。
- ⚠ 事故如实记（二役，新形态）：切换脚本 `.dev/go8-cutover.ps1`（Stop→装→Start→25s→自检+失败自动回滚一体，单条原子）以**代理会话内 bash 后台任务**启动，23:51:58 `SHA OK`+`Stop` 执行后整棵进程树随会话挂起被杀（npm 未跑、Start 未发），生产停机 ~2h49m（23:52→02:44，用户手机掉线）。Main 02:44 手动完成同仪式切换：sha 亲验 → npm i -g → Start → 自检四条全绿（Running/health ok/sessions 401/omp available·Enabled）+祖谱 svchost←services←wininit+官方 CLI agent ls 通；终态 `paseo --version`=0.10.2-go.8。**教训升级：原子性≠持久性——生产切换必须跑在代理会话生命周期之外（hub start persistent 任务或 schtasks 自脱离），会话内后台随会话死**（go.7 成功切换用的正是 hub start persistent 任务，本轮换用 bash async 属流程回退）。

## 生产升级补记（go.6→go.7，2026-10-01）

- 供应链：Releases win32 tarball 162,471,613 B，sha256=`cd9245e1…05466` ≡ body 表（首两次下载被带宽截断/撞坏，断点续传后校验过；**Release7 代理留存份 33MB 已损坏勿用**）。
- 仪式：Stop→npm i -g→Start；自检四条全绿（Running/health ok/sessions 401/omp available·Enabled）+祖谱 svchost←services←wininit；`paseo --version`=0.10.2-go.7；官方 CLI 0.10.1（新净 prefix）agent ls 全量通=向后兼容。
- ⚠ 事故如实记：首次切换命令被消息中断于「Stop 后、Start 前」，生产停机 ~25min（用户手机掉线）；恢复=直接 Start（go.6 包未损）。教训：**生产切换必须单条原子后台命令跑完（Stop→装→Start→自检一体），禁止可中断的分步前台执行**。
