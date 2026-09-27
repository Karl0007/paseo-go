# REVIEW2-INDEX — 批次二审查台账

> 范围=276ebbe6..HEAD（37 commits）。四维度 reviewer：RevCorrectness(F1-F8)/RevCrossLayer(P1-1,P2-2..5)/RevUiSecurity(21 条)/RevHygiene(F1-F14)。去重合并后 26 卡。一卡一根因。状态：open→confirmed/rejected/downgraded→fixing→done/wontfix。

| #     | 级别   | 标题                                                                                                                                           | 来源              | 复核                                                                                                     | 需拍板             | 批次  | 状态                                            |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- | ------------------ | ----- | ----------------------------------------------- |
| R2-01 | P1     | 拖拽落位后 scrollEnabled 冻结无带外释放（onPressOut 拖后不达，handleDragEnd 不解锁）                                                           | RevC-F1           | CONFIRMED P1(原生面闭合:RNGH 接管后 ReactRootView.onTouchEvent 停发,press_out 永不达)                    | 否                 | FIX-A | **done(90e016ce, 设备复验 PASS 453b9dff)**      |
| R2-02 | P1     | 未读双拍第二拍=pending 闭包态：分栏翻转/覆盖点 B/通知进入/指令进入丢拍                                                                         | RevC-F2           | CONFIRMED P1(四子链独立成立)                                                                             | 是(修复形态三选一) | FIX-B | open                                            |
| R2-03 | P1     | 宽屏已读水位结算=下次 focus（可无限延后→离开期间活动静默已读）                                                                                 | RevC-F3           | CONFIRMED P1(窄屏窗口≈0 属实)                                                                            | 是(结算时点)       | FIX-B | open                                            |
| R2-04 | P1     | 断点不随转屏根因只修壳侧；右栏官方 ~20 消费者仍读旧 rt.breakpoint（半更新态下移）                                                              | RevC-F4           | CONFIRMED P1(修正:消费面=63 文件非~20)                                                                   | 是(三选一)         | —     | open                                            |
| R2-05 | P1     | 导入尾调用带按下时 query 落地，requestSeq 反使其必然胜出→列表与搜索框静默不一致                                                                | RevC-F5           | CONFIRMED P1(探针实证 seq 放大)                                                                          | 否                 | FIX-A | **done(90e016ce, 设备复验 PASS 453b9dff)**      |
| R2-06 | P1候选 | 工作区角标/概览"活跃"自写枚举 vs 官方 bucket（initializing 误计、count-only-permission 漏计）                                                  | RevH-F1           | DOWNGRADE→P2(瞬态+信号形态依赖,主注意力面恒对)                                                           | 否(卡面已裁定)     | FIX-A | **done(90e016ce, 设备复验 PASS 453b9dff)**      |
| R2-07 | P1     | 预览屏「下载」与「分享」共用 handler（下载只落 cache 即弹分享面板）                                                                            | RevUI             | DOWNGRADE→P2(官方同款裁定,剩文案冗余)                                                                    | 是(下载语义)       | —     | open                                            |
| R2-08 | P1     | "归档"三义矩阵：壳归档只作用对话 tab（L3 不隐/通知不静音/概览仍计）；关 tab 归档行两态消失且壳内无恢复入口；L2 归档级联会话无确认 toast 不告知 | RevXL-1           | CONFIRMED P1(新证据:壳 L2 归档绕过官方 confirmRiskyWorktreeArchive 风险闸)                               | 是(产品)           | —     | open                                            |
| R2-09 | P2     | Windows 路径盘符/UNC 大小写漏合并（同函数已按 Windows 语义改分隔符=自相矛盾）                                                                  | RevC-F6           | CONFIRMED P2(修正:"自相矛盾"不成立;真问题=仓内 6 处折叠实现,app 唯一不折叠;修法=取服务端口径非新造)      | 是(§14.8 例外)     | FIX-B | open                                            |
| R2-10 | P2     | fork 确认挂起期水位=按下快照（确认后应重取）                                                                                                   | RevC-F7           |                                                                                                          | 否                 | FIX-A | **done(90e016ce, 设备复验 PASS 453b9dff)**      |
| R2-11 | P2     | form-factor 720/992 手抄镜像无对拍闸（真值表未导出；测试自指）；window vs screen [未证实]                                                      | RevC-F8=RevH-F4   | CONFIRMED P2(window/screen 分叉定性=仅 Android≤10 多窗口)                                                | 是(导出真值表?)    | FIX-C | **done(7afdf8ea)**                              |
| R2-12 | P2     | 路由串六处手写+as Href 擦 typed routes+routes.test 自指                                                                                        | RevH-F3           | CONFIRMED P2(.expo gitignore:cast 是否擦除取决于生成物在场)                                              | 部分               | FIX-C | **done(7afdf8ea)**                              |
| R2-13 | P2     | validated storage 双侧(读+写)校验失败静默 removeItem（整店蒸发面比已知更宽）无日志                                                             | RevUI-⑤=REVIEW2#5 | CONFIRMED P2→升级处理(现行可达链:R2-14 NaN→readState 整店蒸发;panel-store 三处 schema 墓碑=既成伤害证据) | 是(本轮修/立卡)    | —     | open                                            |
| R2-14 | P2     | lastActivityAt z.string() 无日期约束→非合规主机渲染 "Invalid Date NaN"                                                                         | RevUI-④           | CONFIRMED P2(协议裸 string×同文件 z.coerce.date 先例;渲染终点 import.tsx:90)                             | 否                 | FIX-C | **done(f34a77e5)**                              |
| R2-15 | P2     | a11y：7 处 icon-only 缺 label、隐藏 pane 未出读屏树(官方同型有补)、L3 注释称播报状态实未播                                                     | RevUI-⑦           |                                                                                                          | 否                 | FIX-C | open                                            |
| R2-16 | P2     | 交互语言分叉 6 处（对话/会话术语、查看项目文件 vs 查看文件、标点、双标题、fork 按钮、diff 大小写）+popover 形态 sheetTitle 死代码              | RevUI-②           |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea)**                              |
| R2-17 | P2     | 降级搜索 haystack 用整条 cwd vs 服务端 basename（注释谎称对齐）                                                                                | RevXL-2           | CONFIRMED P2(server basename 真值行点名)                                                                 | 否                 | FIX-A | **done(90e016ce, 设备复验 PASS 453b9dff)**      |
| R2-18 | P2     | parentHandleId 两形态（路径 vs 原始 id）共用尾段规则→UI 可显示裸 id                                                                            | RevXL-3           |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea)**                              |
| R2-19 | P2     | 关过 tab 的导入重现可导入列表+filteredAlreadyImportedCount 少报；重导复活被陈旧本地归档再隐藏                                                  | RevXL-4           | 拆半:A(server 跳 archivedAt+计数少报)=CONFIRMED;B(本地再隐藏)=两步可恢复降级                             | 部分               | FIX-B | open                                            |
| R2-20 | P2A    | DESIGN §14.10 残留"源活跃启发式"与实现相反；§2.3 路由片段列已退役项                                                                            | RevXL-5           |                                                                                                          | 否(A类随批)        | FIX-C | **done(7afdf8ea)**                              |
| R2-21 | P2     | 概览 M 项目(跨主机聚合) vs 树 L1 行数(按 host 分) 两口径                                                                                       | RevH-F2           | CONFIRMED(口径裁定非缺陷)                                                                                | 是(选口径)         | FIX-B | open                                            |
| R2-22 | P2     | 注释漂移×4（含把人带回已证伪来源的一条）+clearAlias 死导出+L2 菜单无纯矩阵                                                                     | RevH-⑤            |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea)**                              |
| R2-23 | P2     | 假绿/自指断言 5 条+looksActive 测试贴边耦合真实时钟                                                                                            | RevH-⑥            |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea; looksActive 时钟项 deferred)** |
| R2-24 | P2     | 500ms 长按决策与引擎/RN 默认值巧合对齐、注释归因错（官方同类=450）                                                                             | RevH-F5           |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea)**                              |
| R2-25 | P2     | VOICE-DEPLOY.md 0 次警告 baseUrl 缺失回落 api.openai.com+可能用真实 OPENAI_API_KEY（文档安全缺口）                                             | RevUI-⑥           |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea)**                              |
| R2-26 | P2     | 证据卫生：C35 无 evidence 目录(验收②③零产物)、C34 脚本双份(todo 废稿=已实锤坑复现体)、release 桩与 phase0 生成器不一致                         | RevH-⑦⑧           |                                                                                                          | 否                 | FIX-C | **done(7afdf8ea)**                              |

## 已并入既有裁定清单（不重复制卡）

- 关 tab 归档语义（REVIEW2-decisions #1）→ 并入 R2-08。
- L2 归档=数据破坏入口（#4）→ 并入 R2-08。
- validated storage removeItem（#5）→ R2-13。
- 启动期 hydration 前写守卫（#6）→ 随 R2-13 一并裁。
- CLI --all 语义（#7）→ 转上游单（收口时发）。
- journal 增长（#8）→ 维持不修（分叉警示覆盖）。

## 复核庭安排

- 复核 A：R2-01/02/03/04/05/06/07/08（P1 全量，独立核实因果链+severity+是否已修）。
- 复核 B：R2-09/11/12/13/14/17/19/21（P2 高影响抽样）。
- 其余 P2 卫生类信任 reviewer 证据闸（文件:行在册），复核 A/B 撞见的顺手核。

## FIX-C 落地记录（卫生批，2026-09-27）

- **R2-11**：对拍闸已落——`form-factor.test.ts` 解析 `styles/unistyles.ts` 源文本提取
  breakpoints 表并与 `TABLET_SPLIT_MIN_WIDTH_DP`/`TABLET_LARGE_MIN_WIDTH_DP` 对拍
  （真值表未导出、import 会起 unistyles 运行时，故走源解析；不改官方文件）。
  **known_issue**：壳读 window 宽（`useWindowDimensions`）vs Unistyles 自有订阅面，
  仅 Android ≤10 自由窗口多窗口下分叉；该面上 Unistyles 还叠加 C31-F1 旋转滞后，
  裁定保持窗宽面（注释在 `form-factor.ts` / `form-factor.test.ts`）。
- **R2-23**：5 条假绿/自指断言已逐条改真断言（改坏必红证据在 FIX-C 报告）；
  looksActive 时钟耦合项在 `packages/server`＝本批禁碰面，**deferred**。
- **R2-26**：C35 evidence 半已由 `evidence/C35/` 补齐（前批）；本批删
  `todo/C34-repro-draft.sh` 废稿（卡尾已注明唯一出处=evidence/C34/）；release 桩
  与 phase0 生成器对账结论见 BUILD.md §3.5 坑①（生成器改为无条件重生成 lint-clean 版）。

## 修复批次落地记录

- FIX-A=90e016ce（R2-01/05/10/17/06，先红后绿；设备复验三项 PASS=453b9dff CLOSE-DEV1）
- FIX-C=7afdf8ea（R2-11/12/16/18/20/22/23/24/25/26；假绿 5 条先证伪绿再修；对拍闸两枚：断点源解析+路由目录双向）
- R2-14=f34a77e5（协议纯增 parseDateOrNull+全链 NaN 掐断+readState 守卫；R2-13 蒸发链源头不可达，warn 已加、removeItem 行为待拍板）
- 拍板已定（2026-09-28 用户：1a/2a/3a/4 全按推荐，转无人值守）→ FIX-B 双批已落：B1=2dcb59d6（visit-ledger 总线+离开即结算，四子链红→绿）、B2=5e01f2b9（六卡全红→绿；R2-08③ 零新触点=胶囊盖高扩展；R2-04=触点#8 layout.ts）
- 设备窗口二进行中：C34 18 样本矩阵（C34MatrixRun）
