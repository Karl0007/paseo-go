# KI-15 工作区 tab 骨架屏卡死（补证轮实锤，KI-12 回归嫌疑）（立案 2026-09-29）

## 现象（EvidenceRound1 anomalies#1，帧 E2E/03）

对话 tab 正常（1/2 主机在线、列表渲染），**工作区 tab `shell-workspace-skeleton` 持续 >40 分钟**；
下拉刷新、来回切 tab、force-stop 重启 app 全部无效。门条件（读码）：
`hostRegistryStatus==loading || projectsLoading/isInitialLoad` 未归位。
端到端动线的工作区段因此不可走（取证改道：会话屏 ⋯→查看项目文件）。

## 嫌疑排序（立案时判断，供排查起点，不许照抄结论）

1. **KI-12 重构回归（首要）**：`workspace-screen-body.tsx` 被改 83 行（header 搬出滚动容器、
   搜索改右槽 icon→SearchModeBar 变形、inset 拆除）。骨架门/refresh 回调/FlatList 接线在
   搬动中错位（如 skeleton 分支与 header 同级渲染后条件短路、onRefresh 丢失、
   isInitialLoad 的 effect 依赖变了）。对照 `git show 5c3b1e12 -- packages/app/src/shell/components/workspace-screen-body.tsx`。
2. **旧 daemon 交互**：取证时 daemon 是 20:57 旧代码（KI-7 未载）且处于崩溃循环；
   **现已用新代码重启（pid 23232）——第一步先复现：若骨架自然好了，根因=daemon 状态机
   卡 loading（另归 server 侧小卡），本卡降级为"客户端骨架要有超时兜底"**。
3. R1 家族（host-status 聚合 hook 在 React Compiler 下失效，todo/R1-runtime-host-staleness.md）
   的变体：useShellHostStatuses 给工作区 tab 的输入没归位。

## 口径

- 必做：真机复现（现 daemon 新、电量 52%）→ 定位根因（读码+最小实验，不许猜改）→ 修复
  → 定向单测（骨架门的归位条件）→ app 套件失败集=W1∪C1 零新增 → 恰一次 commit。
- 若根因在 server 侧 daemon：壳侧仍要加**骨架超时兜底**（>10s 未归位=显错误态+重试按钮，
  不许无限骨架）——用户永远不该看到 40 分钟骨架。
- 真机帧：卡死复现帧（若还能复现）+ 修复后正常帧，存 evidence/KI15/ 本地。

## 验收

1. typecheck/oxlint 零错；定向+app 套件=W1∪C1 零新增。
2. 真机：工作区 tab 出列表；若走超时兜底路径，注入慢响应能看到错误态+重试。
3. 读图 ≥2（修复后列表帧 + 根因证据帧）存 evidence/KI15/。
4. 报告 JSON：{commit, root_cause, fix, regression_source: KI12|daemon|R1|other, frames, gates}。
