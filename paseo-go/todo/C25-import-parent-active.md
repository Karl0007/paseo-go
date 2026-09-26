# C25 导入列表：父链字段 + 「可能活跃」徽标（protocol 纯增 optional）

## 背景 / 用户拍板

用户：「（导入列表）没有区分父子会话关系，而且看不到会话状态。」取证：descriptor 无 parent/status 字段；omp 列表递归文件扫把父会话与子代理会话平铺混排；omp session 文件头 `{type:"session", id, parentId}` 自带跨会话父链；**外部会话=磁盘 jsonl，无可靠存活信号**（daemon 无 watcher 无探活）。裁定 DESIGN §14.10：父链=正式字段；状态=**mtime 启发式「可能活跃」**，不假造实时状态。

## 设计裁定（照此执行，不得重开）

1. **协议**（`packages/protocol/src/messages.ts` `RecentProviderSessionDescriptorPayloadSchema` 纯增，COMPAT 注释按规）：
   - `parentHandleId: z.string().optional()`、`parentTitle: z.string().optional()`
   - `looksActive: z.boolean().optional()`
   - 跑 protocol `generate:validators`（typecheck 前置会自动跑，勿手改 generated）。
2. **omp provider**（`server/agent/providers/omp/session-descriptor.ts`）：
   - 头部解析已有 session entry 链——取 `parentId`；父文件解析：同次扫描的Ranked 集合内按 `id` 建索引（勿再扫盘），命中→`parentHandleId`=父文件路径、`parentTitle`=父 title/name（父未进扫描窗=只给 handleId 不给 title）；
   - `looksActive` = 文件 mtime 距今 < 5 分钟（常量命名+注释说明是启发式，非存活证明）；
   - claude/codex/pi provider 无父链概念=字段缺席（不改它们的 descriptor）。
3. **壳导入屏**（`src/shell/import/rows.ts` + `import.tsx`）：
   - 子会话行标题前加「↳ 子会话 · <parentTitle‖handleId 尾段>」徽标行（副标题位，勿改主标题）；
   - `looksActive` → 「可能活跃」小徽标（token 色，非灯——避免与会话 tab 四态灯混淆）；
   - 旧 daemon 字段缺席=不渲染（optional 纪律）。
4. 官方桌面 sheet 不消费新字段=无变化（optional 纯增）。

## 范围

- 动：`packages/protocol/src/messages.ts`、`packages/server/src/server/agent/providers/omp/session-descriptor.ts`（+descriptor 测试）、`packages/server/src/server/agent/import-sessions.ts`（透传字段，projection `agent-projections.ts` 若在此处映射则同改）、`src/shell/import/rows.ts`（+test）、`src/app/(shell)/import.tsx`、locales
- 不动：claude/codex descriptor、官方 sheet UI、status 类 RPC

## 工程约束

- 协议铁律：不 narrow、不 transform、纯 optional；COMPAT 注释带日期。
- 定向测试：omp descriptor fixture（有 parentId/父在窗内/父窗外/无父）+ rows 徽标矩阵。
- 与 C23 同文件域（import.tsx/rows.ts）——**排在 C23 之后**。

## 验收（四项证据契约）

1. `npm run build:server` + typecheck + lint 零错误。
2. 定向绿（上列）；`fetch_recent_provider_sessions` 相关既有测试无新增失败。
3. 真机：导入屏 omp 列表——子代理会话（如 C13Release/FinalGate 那批）显示父链徽标；刚跑动的会话显示「可能活跃」；重启 daemon 5 分钟后同会话徽标消失（mtime 过期）。
4. 读图 ≥3 存 `paseo-go/evidence/C25/`。

- 恰好一次 commit；报告 JSON。
