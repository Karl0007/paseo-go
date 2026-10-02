# B8-COUNT 导入屏计数消歧：全量 claim 数 + 说明行（F24）

## 口径（用户拍板=方向 a+c）

现象=对话列表数 与 导入屏「已导入/已归档」数对不上。根因（BATCH8 F24 已定位）=**口径不同轴**：列表=全部 agent；导入屏徽标=（agent ∩ 返回窗 200/500 transcript ∩ handle 匹配）。6597 个 transcript 只扫窗内，老会话出窗→无行可标。

修（不改徽标只标窗内行这一事实，改的是**计数口径 + 消歧**）：

1. **协议**：`fetch_recent_provider_sessions_response` 加**可选** `claimedTotal: number`（服务端全量 claim 索引里被 agent 认领的 transcript 去重计数，不依赖返回窗）。可选字段=向后兼容，旧客户端不读不受影响。跑 protocol validators codegen。
2. **服务端**：`server/agent/import-sessions.ts` 组装 claimedTotal（复用已有 claim 索引，勿全量扫盘）。
3. **壳**：导入屏顶部一行「共 N 个会话已是你的 agent · 列表展示最近 M 条」，N=claimedTotal（旧 daemon 无字段时降级不显示 N）。

## 文件域

- `packages/protocol/src/messages.ts`（+validators codegen）、`packages/server/src/server/agent/import-sessions.ts`、`packages/app/src/shell/import/*` 或 import.tsx 顶部。
- 依赖：B8-IMPORT 之后（同碰 import 屏，串行避免打架）。

## 验收

- 服务端测：claimedTotal=全量（构造窗内+窗外各若干 agent 认领，断言 N 含窗外、去重）。
- 协议 round-trip 测（可选字段缺省兼容）。
- 真机帧：导入屏顶部说明行 N 与对话列表数一致；帧存 `paseo-go/evidence/B8-COUNT/`。
- scoped 三包测绿 + typecheck + oxlint。**恰好一次 commit**。
