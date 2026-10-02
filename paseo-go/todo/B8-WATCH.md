# B8-WATCH watcher 顺 resume 链正向迁移（F28）

## 口径（头号嫌疑=BATCH8-ALIGNMENT F28，卡内先实锤再修）

外部 `omp resume` 续写落**新 transcript 文件**（header `parentSession`→旧文件）；agent 的 persistence/watcher 仍挂旧文件 → 新文件写入不可见 → 不翻外部、进度/preview 不实时。B5-IMPORT2 只修了认领方向（新→祖先），观察方向没跟。

修=观察路径解析**链尾**：

1. 先复现坐实（devd+合成 transcript：文件 A 被观察→新建 B(parentSession→A) 写入→断言当前**不**触发）。
2. `packages/server/src/server/agent/transcript-watch-service.ts`（+复用 omp resume 走链工具，B5 已建）：attach 与 sweep 解析 attach 目标时，从当前文件正向找叶子（同目录 parentSession 链），tail≠当前 → 改挂叶子。
3. 基线语义：迁移到新文件时**不得**因基线重置把持续外部活跃误判回退；累计字节/looksActive 判定跨链连续（卡内定细节，验收以行为为准）。
4. 链走查有成本：只在文件事件/低频 sweep 触发，勿每 tick 全目录扫。

## 验收

- 单测：A→B 链写入 B → watcher 触发（外部翻+preview 推进）；无链行为不回归；daemon 重启后仍跟链尾。
- devd 真机帧：模拟外部续写会话在对话列表 pill 翻「外部」、导入屏活跃标出现；帧存 `paseo-go/evidence/B8-WATCH/`。
- scoped：`npx vitest run src/server/agent` 绿 + typecheck(server project) + oxlint。
- **恰好一次 commit**。服务端卡：devd9 重启归你（测完恢复原 env）。设备/metro 帧道次 ROWPILL>CACHE>WATCH。
