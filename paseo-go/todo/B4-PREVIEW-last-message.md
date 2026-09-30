# B4-PREVIEW: 协议纯增 lastMessagePreview+role（server 投影）

来源：BATCH4-ALIGNMENT.md F4-Q3=b（裁定 3 组）。UI 消费在 B4-ROW，本卡只交付数据面。

## 口径

1. `packages/protocol/src/messages.ts` 纯增（既有触点）：agent 目录条目 `lastMessagePreview: z.string().nullable()` + `lastMessageRole: z.enum(["user","assistant","other"]).nullable()`；重跑 `generate:validators`。
2. server：agent-manager/agent-projections（**新触点，申报**）在消息流处维护两字段（用户消息/助手消息/其它角色映射 other；截断 ≤120 字符去换行）；恢复/hydrate 路径补齐（重启 daemon 后字段不丢：从 timeline 尾部重derive）。
3. 契约钉死（B4-ROW 消费面）：字段名/语义/nullable 语义（无消息=null）。
4. 测试：protocol 套件+server 定向（投影/截断/hydrate）；ws 探针实录（CLI 或脚本连 devd 看目录字段真值）。

## 验收

门禁绿+protocol 全绿+server 定向绿+ws 探针输出在案；触点申报 diff 行数；无 UI（消费在 B4-ROW，如实记）。
