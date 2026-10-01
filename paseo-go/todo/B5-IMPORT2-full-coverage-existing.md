# B5-IMPORT2 导入屏全量覆盖+existing 标记（F17/D20）

## 口径（用户拍板）

- **omp resume 可见的全部会话都要出现在导入页**；不再「已存在即剔除」。
- **metadata-generation 会话不显示**（用户明示，保留现有过滤）。
- 已存在会话打标记：**已导入 / 已归档**；勾选禁用；点行直达（活体→会话，归档→归档筛选+高亮）。

## 实施

1. **协议纯增**（messages.ts 触点扩展）：请求 `includeExisting?: boolean`（缺省 false=旧行为，官方客户端零影响）；响应 entry 纯增 `existing?: { agentId: string; archived: boolean }`。
2. **server**（import-sessions.ts）：includeExisting=true 时不剔除已存在项、逐条挂 existing；false 行为逐字节不变（旧测试全保留）。limit：壳侧提至 200（服务端上限），必要时分页后续卡。
3. **handle 匹配洞**（F17-4）：原生启动 agent 的 persistence handle 与 transcript handle 为何不匹配（截图实证其未被剔除）→ 修到 existing 判定覆盖原生+导入两路。
4. **壳**（rows.ts/import.tsx）：existing 渲染徽标+勾选禁用+点行直达；orphan-group 机制保留（父可见后自然收敛）。

## 验收

- server 定向测：includeExisting 两态、existing 判定含原生/导入/归档三路、metadata 恒隐。
- 真机帧：导入页行数≈omp resume 可见数（同机对照截图）+已导入/已归档徽标+勾选禁用+点行直达各一帧。
- 恰好一次 commit；门禁照旧。
