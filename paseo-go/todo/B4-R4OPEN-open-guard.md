# B4-R4OPEN: R4 守卫挪到开屏时刻（裁定 18）

来源：B4-OWNERSHIP-UI known_issues#1（Main 拍板 2026-09-30）。

## 根因

官方 ensureAgentLoaded 在打开会话屏时 resume→ownership 翻 paseo→发送守卫在主流程永不触发；且**危险时刻本就是开屏（resume=并发 spawn），不是发送**。

## 口径

1. 对话行 tap 打开前：ownership=external 且 externalLooksActive===true → 复用 ownership-send-guard 文案弹确认；取消=不打开（行不导航）；继续=照常导航（后续 resume 现行为）。
2. 分级表同款：opencode 免弹/codex 弱化/其余标准（复用 680940e1a 的分级模块，别造第二套）。
3. 发送守卫保留（次防线：打开后仍 external 的路径，如 resume 失败态）。
4. 平板分栏列直接选中（非 tap 导航）路径：选中即开屏=同守卫挂点，实证接线写报告。
5. locales 如需新增键 zh/en；测试=守卫分流单测+真机帧：external·运行中行 tap→弹窗→取消不开/继续开屏（≥2 帧）。

## 验收

门禁+scoped 绿；真机帧两拍；恰好一次 commit。
