# C22 导入出处 label：daemon 咽喉点盖章（上游最小正式改动）

## 背景 / 用户拍板

用户问「能区分 paseo 原生 session 还是主机上原有的 session 吗？」——现状不能（`StoredAgentRecord` 无出处字段，import 注册与原生 createAgent 同构，`reason:"import"` 不落盘）。labels 全链现成（request.labels→落盘→`AgentSnapshotPayload.labels` 下发）。裁定 DESIGN §14.1：在**唯一导入咽喉点**盖章，官方桌面同样受益。

## 设计裁定（照此执行，不得重开）

1. `packages/protocol/src/agent-labels.ts`：新增 `export const IMPORTED_PROVIDER_SESSION_LABEL = "paseo.imported-provider-session";` + helper `isImportedProviderSession(agent: AgentLabelSource): boolean`（值=="true"）。
2. `packages/server/src/server/agent/agent-manager.ts` `importProviderSessionInternal`：`registerSession(..., { labels: { ...input.labels, [IMPORTED_PROVIDER_SESSION_LABEL]: "true" }, ... })`。
3. `packages/server/src/server/agent/import-sessions.ts` `importProviderSessionNow` 的**归档重导入路径**（unarchive 分支）：若 archivedRecord.labels 无该键，labelPatch 补上（与 PARENT_AGENT_ID_LABEL 同法）。
4. 协议 schema **零变更**（labels 本就是自由 record）；不新增 RPC。

## 范围

- 动：上列 3 文件 + 就近测试（import-sessions.test.ts / owned-subscriptions 相关）
- 不动：agent-storage schema、任何 UI（消费方是 C24/C25）；壳文件

## 工程约束

- 上游风格：常量+helper 进 agent-labels.ts 单一出处，消费方 import，禁字面量散落。
- 测试按 docs/testing.md（真实依赖优先）；定向跑改到的测试文件。
- 门禁：`npm run build:server` 先行再 typecheck（跨包声明）。

## 验收（四项证据契约）

1. `npm run build:server` + `npm run typecheck` + `npm run lint` 零错误。
2. 定向绿：①import 路径→记录 labels 含键；②原生 create→无键；③归档重导入补章；④helper 边界（null/非 true 值）。
3. 真实运行：重启 dev daemon（hub 管理的 devd，允许）→ CLI 导入一条真实 omp/claude 会话 → `fetch_agents`（CLI 或脚本）断言该 agent labels 含键、原生 agent 不含。
4. 读图：终端输出截图/日志片段存 `paseo-go/evidence/C22/`（此项以命令输出为准，截图可免，报告注明）。

- 恰好一次 commit；报告 JSON。
