# B8-CACHE 快照缓存补两轴，刷新不回跳未知（F25）

## 口径（根因已在 BATCH8-ALIGNMENT F25 静态闭合）

客户端持久化快照缓存 `serializeAgent` 白名单不含所有权/出生两轴 → 经缓存回水化的刷新把字段剥光 → pill 从 原生/外部 回跳「未知」（live 会话也中招）。

修=三键进缓存、round-trip 无损：

1. `packages/app/src/runtime/replica-cache/index.ts`：`StoredAgent` 类型 + `serializeAgent` + `deserializeAgent` 补 `ownership`、`externalLooksActive`、`origin`（字段名以 `packages/app/src/utils/agent-snapshots.ts` 现状为准，约 149/154 行）。
2. `agent-snapshots.ts` 的 `projectAgentSnapshot` 同步回投三键；删除/改正「NOT projected back out」过时注释。
3. 兼容：旧缓存行无三键 → 反序列化落 undefined（=未知），不抛。

## 验收

- 回归测：带两轴的 Agent 过一遍 serialize→deserialize round-trip 后字段逐一相等；旧行无键兜底用例。
- 真机帧：live 会话 pill=原生/外部时**下拉刷新两次不回跳未知**（前后帧）；帧存 `paseo-go/evidence/B8-CACHE/`。
- scoped：`npx vitest run src/runtime/replica-cache src/utils` 绿 + typecheck + oxlint。
- **恰好一次 commit**。设备/metro 道次序 ROWPILL>CACHE>WATCH（ROWPILL 在途时先做静态+单测，帧等 hub 放行）。
