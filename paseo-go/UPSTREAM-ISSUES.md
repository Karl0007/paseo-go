# Paseo Go → 上游（getpaseo/paseo）问题清单

> 批次二收尾汇总（2026-09-28）。fork 侧全部已规避或修复；本清单=可提交上游的独立问题，各条带复现/证据出处。

## 1. Unistyles `rt.breakpoint` 运行中不随转屏更新（P1，已本地修）

- 现象：JS 上下文创建后转屏，Fabric 原生重排到新宽度（uiautomator 根 bounds/dumpsys 证实），但 `rt.breakpoint` 不更新 → 所有断点键控逻辑停在旧形态；横→竖可翻回，竖→横不翻；冷启动正常。
- 证据：`paseo-go/evidence/C31/`（C31-F1 复现 2 次）、`paseo-go/todo/C31-tablet-wiring.md` §未修发现。
- 本地修：`constants/layout.ts` useIsCompactFormFactor 改 `useWindowDimensions()<720`（COMPAT(shellFormFactorRotation)）；建议上游同样收敛（或修 unistyles 订阅）。

## 2. 关 root agent tab = 静默归档，无恢复入口（P1 产品语义）

- 现象：`close-tab-policy.ts` root agent 关 tab 即发 archive RPC → `archivedAt` → 从活跃目录无条件剔除（`use-aggregated-agents` 默认过滤）；`paseo agent ls --all` 亦走 scope=active 无视 includeArchived → 用户"会话消失"且 CLI/列表均不可见。
- 证据：daemon.log `archive_agent_request` 与记录 archivedAt 10ms 咬合（C35 卡）；`session.ts:5389-5395`。
- 建议：归档列表入口/取消归档 RPC 暴露到 CLI `--all` 真值语义；或关 tab 归档加确认。

## 3. sidebar 行归档风险闸在 gitRuntime 未解析时恒开（P1，上游同源缺陷）

- 现象：workspace descriptor 的 `gitRuntime/diffStat` 为懒填充（`peekSnapshot` 未解析=缺字段）；`confirmRiskyWorktreeArchive` 空风险 auto-pass → 官方 sidebar 行菜单归档在未观察过的 worktree 上不弹风险确认。官方 screen 面（use-actions live overlay + canArchive fail-closed）已有正确姿势，sidebar 面未对齐。
- 证据：FixB3 定性链（archive-gate 报告在册：`sidebar-workspaces-view-model.ts:180-181`、`worktree-archive-warning.ts:86-123`、`session.ts:5570-5587`）；壳侧真机事故复现=同输入不弹框。
- 建议：sidebar 归档动作对齐 screen 面：动作时 `ensureCheckoutStatus` 实取 + 未知即 fail-closed。
- 补充（FixB4）：`selectProjectWorkspacesToArchive` 的 `kind==="worktree"` 跳过确认在级联归档语义下=无闸数据破坏面——服务端 teardown 与 kind 无关（`workspace-archive-service.ts` `archiveWorkspaceContents` 按 workspaceId 归档全部 agent），`local_checkout` 行（主 worktree 即此 kind，CLOSE-DEV3/4 事故面）零弹直归档。建议上游对齐 screen 面 `canArchive` 的 fail-closed 姿势并覆盖全部可级联会话的 kind。

## 4. RNGH 2.28 组件树重挂期确定性红屏（P1 上游库）

- 现象：手势 detector 挂载中，同一提交内卸载含 detector 的子树 → `Unable to find node on an unmounted component`（layout-effect attachHandlers 级联到删除中 detector 的 mount-listener，findNodeHandle 打已删 host）。
- 证据：C32 双层根因记录（`todo/C32-tablet-detail-column.md` 裁定 5）；真机 100% 复现配方=会话打开态转屏触发旧结构重挂。
- 本地规避：壳零重挂包装链。建议上游修 RNGH 或文档化"含 detector 子树禁止同提交换槽"。

## 5. `workspace-same-cwd-isolation.e2e` 两例在 HEAD 必红（测试腐化）

- 现象：`Provider mock is not configured`——用例（上游 `3288e1cf` 引入）未传 `isDev:true`，其后 #4314/#4332 把 mock provider 注册收进 isDev 闸。
- 证据：`paseo-go/todo/W1-suite-baseline.md` 批次二补记（因果链+零 fork 触点核对）。
- 建议：测试补 `isDev:true` 或 provider 注册面放宽。

## 6. omp `session_exit` 分叉使 `leaves.at(-1)` 选错活动分支（已修，可回收）

- 现象：外部 `omp -r` 追加+daemon resume 各写一支 exit，文件序最后叶可能是 exit-only 兄弟分支 → 历史重放读到追加前旧链（导入会话"刷新不更新"）。
- 本地修：`providers/omp/history.ts` selectActiveOmpLeaf（最新可见条目优先，O(n)）+回归 e2e（`f7ed26b1`，修复前失败证明=C24 症状逐字）。
- 建议：上游回收该补丁（附 `paseo-go/evidence/C35/` 行级取证）。

## 7. 每次 omp refresh 向导入源文件追加 session_exit 分支（journal 增长）

- 现象：refresh 的 resume 语义使源 jsonl 分叉累积（omp 语义固有）；用户面壳已加分叉警示。
- 建议：上游考虑只读重放路径（不 attach）。

## 8. `validated-persist-storage` 双侧校验失败 removeItem（破坏性，已本地修）

- 现象：envelope 漂移（schema 演进/版本回退）时读侧清店、写侧失败清店=全量本地态静默蒸发；仓内 panel-store 三处"墓碑键"注释=既成伤害自证。
- 本地修：保留原文+拒该次+warn（`5e01f2b9`，测试 9 例）。
- 建议：上游对齐（该文件为官方 storage 面）。

## 9. desktop「纯客户端模式」缺默认档：`keepRunningAfterQuit` 默认 false（P2 产品建议，fork 侧仅评估未改行为）

- 现象/背景：Paseo Go 的目标形态是「壳 APK(客户端) + 远端主机 daemon」。desktop 装到第二台机器时，其内建 daemon 语义（`manageBuiltInDaemon` 默认 true、退出即停 daemon `keepRunningAfterQuit` 默认 false，`src/daemon/quit-lifecycle.ts`）与「只是想要一个 UI」冲突：关掉 desktop 窗口=顺手停掉本机被连的 daemon，其它客户端(壳 APK/官方手机 app)连接随之断。
- 现状：两开关都在 desktop 设置里可改（`desktop-settings.ts` daemon 段），但默认组合面向「desktop 即宿主」场景；纯客户端用法要求每次装后手改两处。
- 建议：给 desktop 出一个「纯客户端模式」预设（默认 `keepRunningAfterQuit=true`，或一个模式开关一次翻齐），并让 `autoUpdater` 的更新检查在该模式下不依赖 daemon 存活。
- 处置（M4 拍板）：fork 侧本轮**不改行为**（本机禁忌#1：desktop 不装不跑，改默认档无本机证据链）；desktop 更新源触点已单独落地（`electron-builder.yml` publish 指 fork Releases，COMPAT(paseoGoUpdateFeed)）。若未来「其他机器装 desktop」成为常态，再按本条出补丁。
