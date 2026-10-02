# B9-SUBACT 子任务运行可见性 B+（F31 拍板）

## 口径（用户拍板=B+：传染+徽标+导入屏子行实况）

1. **watcher 观察单位「链」扩「树」**：omp 子代理 transcript 在**父 sessionId 命名的子目录**（B9Watch2 生产实锤：`01a0e101…/` 下 62 个）——发现=观察条目附带 stat 该子目录，命中新增/增长=该 agent 有外来子任务在跑。成本闸沿用 chase 两档；链尾记忆同样适用于子目录内新文件。
2. **运行态传染**：子目录活跃 → 主会话 ownership 翻 external + 投影「运行中」语义（与 F33 live-idle 同一判定面：daemon 不在写而子树在长=外部跑）。
3. **协议**：agent 快照新增可选 `activeSubagents?: number`（COMPAT(subagentActivity)，=近活动窗内有过写入的子 transcript 数；0/缺席=不显徽标）。跑 validators codegen。
4. **对话行徽标**：右缘槽位家族（B9-BADGE `7f53d8a81` 的圆标纪律：圆形/同尺寸/shrink-0/主题 token）新增「子任务×N」圆标，排在未读标记**之后**（行最右一枚让给未读，子任务标次右；两标同屏时顺序=spinner→时间→未读→子任务）。zh「子任务」/en 双语进壳 i18n。
5. **导入屏子行实况**：被观察 agent 的子 transcript → 服务端 descriptor looksActive 由 watcher 实况驱动（替换 mtime 估算）；**未被观察的会话维持 mtime 估算**（没人在看=无实况可给，如实注释）。

## 文件域

`server/agent/transcript-watch-service.ts`（树观察）、`agent-manager.ts`/`agent-projections.ts`（计数投影）、`agent/import-sessions.ts`（子行实况）、`packages/protocol/src/messages.ts`(+codegen)、`shell/components/chat-list-row.tsx`(+test)、`shell/import/rows.ts`/`(detail)/import.tsx`(+tests)、locales。非目标=手势、缓存、replica-cache。

## 验收

- 单测：子目录新增→传染翻外部+activeSubagents 计数；静默窗→计数衰减归零不显标；daemon 自写不误计；未读+子任务同屏顺序断言；导入子行实况覆盖 mtime 估算（被观察态）。
- devd9 真机帧：合成「父+子目录活跃子」→ 对话行 pill 外部·运行中+右缘「子任务×N」圆标；导入屏同会话展开子行「可能活跃」亮。亲自 read，存 evidence/B9-SUBACT/。
- scoped（server agent+app components/import 域）绿+全量 typecheck+oxlint。**恰好一次 commit**（令牌制；协议+server+app 同卡可一 commit，跨面包=同契约原子性）。
