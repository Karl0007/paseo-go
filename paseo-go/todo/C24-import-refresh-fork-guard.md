# C24 导入会话：刷新动作 + 分叉警示（消费 C22 label）

## 背景 / 用户拍板

用户问「导入了电脑端正在运行的会话，导入后能持续同步吗，还是会分叉？」取证结论：导入=引用+快照；**无自动同步**（官方 `refresh_agent_request` = rehydrateFromDisk 重放源历史，桌面端 tab 菜单有"Reload agent"，壳无入口）；**只读+刷新永不分叉，双写必分叉**（app 发消息会 resume 源会话；桌面端进程还活着=同文件双写）。裁定 DESIGN §14.10。**依赖 C22（label 盖章）先落。**

## 设计裁定（照此执行，不得重开）

1. **刷新动作**：仅对带 `paseo.imported-provider-session` label 的会话出现——
   - 长按菜单（`chatMenuPlan` 加 `refresh` 项，imported-only）与胶囊 ⋯（C21 矩阵）各一处；
   - 执行=官方现成 RPC `client.refreshAgent(agentId)`（archived-agent-callout.tsx 同款用法）→ toast 结果；进行中禁用重复触发。
2. **分叉警示（一次性确认）**：`src/shell/chats/open-agent.ts` opener `open()` 时，若目标带 imported label 且**本机未确认过**→ 先弹官方确认对话框（文案：源会话若仍在电脑上运行，从 app 继续会产生分叉；确认=继续进入，取消=留在列表）；确认后写壳 store（新 `paseoGo.forkAck`：agentKey 集合，随 clear-local-data 一并清）→ 该会话不再弹。
   - 不做"源是否真活跃"的假启发式（无可靠信号，C25 的 looksActive 只用于导入列表）。
3. 未盖章会话（C22 之前导入的存量）=按原生对待，不弹不刷新（如实限制，报告 known_issue 记一行）。

## 范围

- 动：`src/shell/shellAgentActions.ts`（+menu plan+test）、`chat-list-row.tsx`/`ChatRowMenuContent`、`src/shell/chats/open-agent.ts`（+test）、新 store `src/shell/stores/forkAck.ts`（+test，姿势抄既有 store）、`clear-local-data.ts`（+test 断言覆盖）、`session-header` 矩阵（与 C21 协调，若 C21 已落则在其矩阵上加项）、locales zh/en
- 不动：daemon、refresh RPC 本体

## 工程约束

- open-agent 保持依赖注入 React-free（既有测试姿势）；确认对话框走注入回调，单测不碰原生。
- 与 C21 同文件域（session-header 矩阵）——**必须在 C21 之后执行**，冲突时以 C21 落地面为基线。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：menu plan（imported×非 imported）、opener 警示时序（弹/确认/取消/二次不再弹）、forkAck store、clear-local-data 覆盖。
3. 真机：导入一条 omp 会话（C22 后新导入=带章）→ 长按菜单见"刷新"；刷新后新轮次出现（在桌面端 omp 会话里再发一条→app 刷新→时间线增长）；首次打开弹分叉确认，确认后不再弹；原生会话无刷新项不弹窗。
4. 读图 ≥4 存 `paseo-go/evidence/C24/`。

- 恰好一次 commit；报告 JSON。
