## 生产升级补记（go.6→go.7，2026-10-01）

- 供应链：Releases win32 tarball 162,471,613 B，sha256=`cd9245e1…05466` ≡ body 表（首两次下载被带宽截断/撞坏，断点续传后校验过；**Release7 代理留存份 33MB 已损坏勿用**）。
- 仪式：Stop→npm i -g→Start；自检四条全绿（Running/health ok/sessions 401/omp available·Enabled）+祖谱 svchost←services←wininit；`paseo --version`=0.10.2-go.7；官方 CLI 0.10.1（新净 prefix）agent ls 全量通=向后兼容。
- ⚠ 事故如实记：首次切换命令被消息中断于「Stop 后、Start 前」，生产停机 ~25min（用户手机掉线）；恢复=直接 Start（go.6 包未损）。教训：**生产切换必须单条原子后台命令跑完（Stop→装→Start→自检一体），禁止可中断的分步前台执行**。
