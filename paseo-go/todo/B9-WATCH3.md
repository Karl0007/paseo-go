# B9-WATCH3 resume 链走查加固：命中即停+链尾记忆+窗口扩容（F28-KI1 后续）

## 口径（B9Watch2 诊断附带发现的真实脆弱性）

现 chase：目录 >64 transcript 时只读「比父新」候选的最近 24 个头 → 洪泛目录（几十个子代理/新会话比 resume 子文件更新）下真子落窗外跟丢。修=

1. **命中即停**：候选按 mtime 降序读头，命中 parentSession==父 sessionId 即停（现状语义保持，但上限 24→200）。
2. **链尾记忆**：命中后把链尾路径记在观察条目上；后续 chase **先 stat 已知链尾的兄弟新增**（同目录新文件且 mtime>链尾才考虑重扫），不再每档全窗读头。
3. UUID 形 parentSession 静默停走=正确退化（b71a47555 已注释），本卡不动。

## 文件域

`server/agent/transcript-watch-service.ts`、`providers/omp/session-descriptor.ts`(+tests)。非目标=agent-manager（b71a47555 已定）、客户端。

## 验收

- **洪泛复刻单测（修复前必红）**：1 父 + >24 个更新的无关 transcript + 1 真子（parentSession→父）→ chase 档内跟到子；再写孙 → 跟到孙（链尾记忆生效：无关文件继续增多不掉队）。
- 成本回归测：链尾已知时 chase 不读全部头（断言 readHead 调用次数有界）。
- scoped server 绿（排除 e2e）+typecheck+oxlint。**恰好一次 commit**（令牌制）。
