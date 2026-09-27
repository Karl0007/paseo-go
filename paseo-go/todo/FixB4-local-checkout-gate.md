# FixB4 [壳域] L2 归档闸覆盖 local_checkout 行（R2-08② 剩余缺口）

## 现象（用户可见后果）

工作区 L2 长按"归档工作区"对 `workspaceKind==="local_checkout"` 的行（含主 worktree 行——CLOSE-DEV3 事故 23+23 级联即此面）**无任何确认直接归档并级联归档其全部会话**。FixB3 的双层闸（live overlay + null fail-closed）只覆盖 kind==="worktree"：官方 `selectProjectWorkspacesToArchive` 仅对 worktree-kind confirm，`overlayLiveCheckoutRisk` 同样跳过非 worktree。设备面实弹取证=CloseDev4 g5-xx（一次性 C:/tmp/gate-main 记录）。

## 根因

闸语义照抄官方 sidebar（`selectProjectWorkspacesToArchive` 的 kind 过滤），而官方 skip 的前提（desktop sidebar 有归档列表可恢复+行级作用域小）在壳内不成立：壳内归档=行从树消失、级联到会话、恢复入口深。**壳裁定（3a+本卡）：对一切会级联归档会话的 L2 动作，风险确认必弹**——local_checkout 与 worktree 同闸，directory-kind 维持官方 skip（其语义=仅目录记录，不级联会话；若取证显示也级联则一并入闸，FixB4 内核实）。

## 修复方向（根因级）

`shell/workspace/archive-gate.ts`：confirm 判定从 `kind==="worktree"` 改为 `kind==="worktree" || kind==="local_checkout"`（风险字段=同套 live overlay 按 cwd 实取 + null fail-closed 通用告警）；locales 复用既有 archiveGate.\* 键。这是对官方语义的**有意偏离**，注释注明事故证据（CLOSE-DEV3/4）+ UPSTREAM-ISSUES #3 关联。

### 并入项（CloseDev4 item8 设备实锤）：tab 行遮蔽竖屏差 4px

`tab-row-cover.ts` compact 分支 cover=37dp=92.5px，但官方 tab 行上沿实测比 token 数学低 ~4px（RN 逐节点整数取整），bar 底边露 4px 窄条 → 点 (800,309/311) 可弹「切换标签」sheet → 关 tab→归档入口竖屏仍可触达（g6-05/06）。修法=compact cover +4dp 冗余+注释钉实测差；横屏 native-wide 分支全覆盖无需动。验收=行底边三点注入零反应 + 壳外官方 tab 行不受影响 + tab-row-cover.test 对拍闸同步。

## 验收

1. 回归先红：local_checkout 脏→必弹（官方富文本）；null→通用告警；干净→直通保持；directory-kind skip 保持；级联计数进告警文案（若官方 message 不含会话级联事实，壳侧在通用告警文案补一句"其 N 个会话将一并归档"——N=合并行 workspaceIds 对应 agent 数，取证后定）。
2. tab 行遮蔽：cover 纯函数矩阵（compact +4dp 冗余后高度钉值）+对拍闸更新绿。
3. 定向 archive-gate/derive/locales/tab-row-cover 全绿；tsgo 绿。
4. 设备复验（窗口五）：gate-main 形态 local_checkout 脏→弹框；主 worktree 行长按→弹框（取消 no-op，不实弹主行）；竖屏 tab 行底边三点（y=309/311/312）注入零反应。
5. 恰一次 commit；UPSTREAM-ISSUES #3 补句。

## 范围

- 动：`shell/workspace/archive-gate.ts`(+test)、locales（如需）、UPSTREAM-ISSUES.md
- 不动：官方文件、workspace-screen-body（接线已含）
