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

## 设备复验（窗口五 CLOSE-DEV5，2026-09-28 凌晨，HEAD=0b2a7c3f；证据 `evidence/CLOSE-DEV5/`，逐条见 device-findings.log）

验收 4 全项 **PASS**，无遗留：

1. **local_checkout 脏必弹**（d1-00..03）：gate-d1 夹具（daemon 自然建 kind=local_checkout + 未跟踪
   DIRTY.txt）L2 长按归档 → 官方富文本框「归档「master」？/ 未 commit 的变更」；取消=纯 no-op（行在、
   archivedAt=null）。CLOSE-DEV4 g5 零对话框面已闭合。
2. **主 worktree 行**（d2-00..04）：真实现场 Karl0007/paseo 主 worktree 合并行（23 条 local_checkout，
   仓脏）→ 逐记录官方弹框（首弹含 diff 统计「新增 30076 行, 删除 104 行」）；全部取消=纯 no-op
   （23 记录 arch 全 null、全局 archived=0）。未确认任何一弹。
3. **null-risk 通用告警含级联句**（d3-05..07）：worktree 记录 + 「is-inside-work-tree=true 且 status
   必失败」损坏仓（截断 .git/index；消失 cwd 与纯目录两形态分别被启动 reconciliation 自动归档/重分类
   directory，见 findings 基建坑 1-2）→ 壳侧告警「无法确认该工作区是否有未提交内容，仍要归档？\n其 1 个
   会话将一并归档。」N=1=该行 L3 会话数；取消=纯 no-op。
4. **竖屏 cover 闭环**（d4-00..04）：header 底边 308→318（+4dp 冗余生效）⊇ tabs-row 315/trigger 312；
   (800,309)/(800,311)/(800,312)/(800,267) 四点注入零反应（无「切换标签」sheet、无 tab-menu 节点）；
   阳性对照=返回键双向导航生效。
5. **壳外不受影响**（d5-00..03）：壳模式关 → 官方会话屏 tab 行点行中心 → 「切换标签」sheet 正常弹出；
   `paseogo://me -p` 深链回壳，壳模式恢复 ON。
6. **directory-kind 级联弹框**（d6-00..03）：gate-dir6（kind=directory + 1 会话）→「该工作区有 1 个会话，
   归档会一并归档这些会话，仍要归档？」；取消=纯 no-op；确认→仅该记录 archivedAt + 其 agent 级联归档，
   其余记录零波及、行消失。现场已恢复（夹具记录/agent/目录全清，registry 回 31/0 基线 + devd 重启）。
7. **0.2.0 显示**（d7-00）：我的→关于「Paseo Go 0.2.0」+「上游 paseo @ db4fd334」同帧（bundle 内
   FixB4 三标记各 5 处命中=新码实锤）。

设备复位：IME 百度、rotation 0、壳 ON、pins/收藏/指令未触碰、app 留 home。
