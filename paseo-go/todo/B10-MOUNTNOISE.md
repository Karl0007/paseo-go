# B10-MOUNTNOISE mount 噪音行毒化去重与预览（F34）

## 症状（用户截图 02:3x，生产 go.11）

每次 resume（含终端外部）transcript 落一条全同噪音「xd://: mounted mcp\__genmedia_\*…」（MCP 工具挂载通知，工具表不变则逐字节同）。后果①终端续写的会话 pill 停「原生」（外来证据被吞）；②该行成为 preview 污染对话列表小字。

## 根因（静态读链实锤，卡内补运行时复现）

`agent-manager.ts:4209+` R4-01 belt `dropTimelineTailDuplicates` 按**渲染后内容**与时间线尾部对齐：终端 resume 写的 mount 行与 daemon 早前 app-resume 写过的同名行内容全等→被判「paseo 自己字节回声」→`settledObservation=true` 不升外部。同行为消息进 `advanceAgentLastMessage`→preview。

## 修复方向（卡内按复现选，根因级禁特判）

1. **身份化去重**：omp transcript 行若带原生 id/timestamp 字段，tail-dedup 改按 (内容+行身份) 或 raw 行比对——只有真·同一次写入的回声才吞；不同进程的同行文本不再误判。若行无身份字段，退而求其次：dedup 只在**已知重放窗**内生效（death-flush/release-baseline/journal-shrink 触发标记），平时外来行不吞。
2. **预览/时间线降噪**：mount/挂载类系统通知行映射为 meta（不进 preview、不占「我:/末条」位），provider mapper 层解决，导入屏与会话行同时受益。
3. 运行时复现钉死：app 开一次会话（timeline 有 mount 行）→终端 append 同 mount 行+一行真外来消息→断言先翻外部（或 mount 行不吞+第二行翻），修复前停原生。

## 验收

复现测修复前必红；「真回声被吞」（R4-01 原场景：death-flush 重放）不回归；preview 不再出现 mount 行（测+真机帧）；终端纯 mount 行 resume（还没聊）时的 pill 语义在卡内定案（行身份方案=外部·静默；重放窗方案=保持原生直到真消息——选其一并写明理由）。
