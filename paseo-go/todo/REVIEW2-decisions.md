# Review 轮裁定清单（批次二收尾，Main 汇总）

> 用途：review 轮逐条过；每条=已发生的事实+待拍选项。标 ★=需用户拍板，其余 review 轮内可自裁。

## 产品裁定项

1. ★ **官方"关 root agent tab=归档"语义在壳内的适用性**（C35 known_issue 移交）。事实：官方 workspace-screen 关 tab 对 root agent 发 archive RPC（close-tab-policy.ts:5-13）；壳会话屏仍可达官方 tab 下拉行（C21 截图 01 在案）→ 用户从壳关 tab 会静默归档会话（C24 真机误触实锤：行从对话列表掉出）。选项：a) 壳内隐藏官方 tab 行（胶囊盖顶已盖住 header，tab 行在其下——可扩盖）；b) 保持官方语义不动（用户教育）；c) 壳拦截 archive RPC 转本地隐藏。
2. ★ **rename 屏从会话胶囊进入会弹回对话列表**（C33 known_issue）。事实：(shell) 隐藏 tab 复用导航（C14 实锤），"回列表"与卡验收一致；若要保会话需 (detail) 实例（C16 姿势，成本=一屏双实例）。
3. **拖拽落非置顶区=钳入置顶组**（C20，§14.4 裁定推论）——维持或改"落非置顶=取消置顶落该位"？现状有注释+单测。
4. **L2 worktree 长按归档=真数据破坏入口**（C26）：代码路径官方乐观归档原语，真机未实弹（毁 dev 数据风险）；发布前是否实弹验一次（用后即弃的 worktree）？

## 硬化候选（review 轮裁：本轮做/立卡/不做）

5. **validated storage 读侧 safeParse 失败 → removeItem 整店蒸发**（C34 分析发现）。envelope 漂移/版本升级失误=该 store 全量本地数据静默清零。改"保留原文+只失败该次+上报"。
6. **启动期 onFinishHydration 前 setState 回滚竞态**（C34 模拟④实证存在，本案无现行触发方）。纪律入 CLAUDE/BUILD 或 store 层加写守卫。
7. **CLI `paseo agent ls --all` 走 scope=active 无视 includeArchived**（C35）→ 转上游 issue。
8. **每次 omp refresh 向导入源文件追加 session_exit 分支**（C35，journal 增长）——用户面已有分叉警示覆盖，不修是否可接受。

## 遗留 known_issue 台账（销卡核对用）

- KI2/KI3/#4659/后台推送/700ms 观察/正式签名（v0.1.0 结转，未动）。
- C24：存量导入会话（C22 前）无章=按原生对待（不弹不刷新）——发布说明是否需要文案。
- C27：commit-diff 面板壳内不可达→按压复制 sha（预授权降级）；实例B diff 段未单独截图（同代码路径）。
- C31-F2：release+debug 同注册 paseogo:// → 深链弹系统选择器（F8 只分官方/壳，非缺陷；文档化即可）。
- C34：known_issues#2 改口径"未复现+观察污染，待 C34 双轮裁决"（P2 维持）。
- C28：语音端到端=待用户部署端点（VOICE-DEPLOY.md 就绪）。

## 设备窗口清单（收尾统一拍板/执行）

- C35 真机半环：app 刷新→时间线增长实拍（daemon 等价链已绿）。
- C34 设备波：repro 脚本双轮（debug+release；脚本=todo/C34-repro-draft.sh，C34 分析轮产物，待入库）。
- 拖拽真人手指复验（v0.1.0 唯一开放项，结转）。
- release APK v0.2.0 全链（BUILD §3.5 一键+整机内存分时）。
