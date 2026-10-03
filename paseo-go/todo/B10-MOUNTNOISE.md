# B10-MOUNTNOISE mount 噪音行毒化去重→外部会话误判原生（F34）

## 症状（用户截图 02:3x / 04:18，生产）

每次 resume transcript 落一条「xd://: mounted mcp\__genmedia_\*…」（MCP 挂载通知；工具表不变则逐字节同，journal id 每次新）。终端续写的会话 pill 停「原生」；该行还成为列表 preview。

## 实测定案（推翻卡初稿两处假设）

1. **mount 行在 journal 里是 `role:"assistant"` 消息行**（本机会话 journal 15 条实证）→ 被 mapper 映射为 assistant_message → tail-dedup **按内容**比对命中时间线里早前那份（app 打开会话时 daemon 自己 resume 写的 m1）→ 外来 m2 被当「自己字节回声」吞 → 不升外部。d6484fa 的 journal 零 mount 行（其 03:24 帧=go.11 的 F33 盲区，04:18 帧=app 打开屏 daemon 自己 resume 的瞬间，原生属实）——**两种根因同症状，F33 修「没在看」，B10 修「看了但吞了」**。
2. **流侧 id 与 journal id 不同空间**（omp.exe 二进制实锤：`liveMessageId = crypto.randomUUID()`，journal 行 id 是 8-hex）→ 朴素的「双方有 id 就比 id」会破坏 R4-01 death-flush 吞回声（fake-client 测无 id 不报，生产炸）——**已否决**。

## 实现（provenance 方案）

`agent-manager.ts`：manager 维护 `journalRowIds`（每 agent 有界 FIFO 1024，只登记**从 transcript 观察/replay priming 进入时间线**的行 id；流式行不登记）。`dropTimelineTailDuplicates`：窗口行 id ∈ 登记集 → 身份=比 id（外来同文新 id 不再被吞；真重放同行同 id 照吞）；否则旧内容兜底（流式行 death-flush 场景原语义不动）。三处登记点=live/stored 观察路径+initialTimeline priming；三处随 timelineStore.delete 清理。

## 验收（已达成）

- 回归测 `B10-MOUNTNOISE`（agent-ownership.test.ts）：m1 观察入册 → 外来同文 m2 **必成第二行**（修复前红=1 行实证，stash 复跑）；同 id 重放照吞（对照组恒绿）。
- R4-01/03/04 全族 + watcher 套 94/94 绿；server 全量门禁见下。

## 遗留（不在本卡）

- **preview 污染**：mount 行是合法 assistant 消息（harness 写死），paseo 侧无结构特征可辨、拒绝内容特判。根治=omp 侧把通知写成非 message 行型（mapper 按设计跳过未知类型）→ 转上游需求（omp 仓）。旧 journal 里的历史噪音行留在原地（无害）。
