# C18 未读改完结制 + 双点收敛

## 背景 / 用户拍板

用户：「又有一个绿色的小点，又有一个蓝色的小点。而且未读状态不是在一个任务完全执行完之后才出现，好像任何一个步骤都能触发未读。」两缺陷均成立（取证见 NEXT-requirements Q4）。裁定 DESIGN §14.6。

## 设计裁定（照此执行，不得重开）

1. **未读判据完结制**：`src/shell/chats/derive.ts` `isChatUnread` 从 `max(lastActivityAt, attentionTimestamp) > lastReadAt` 改为 **`attentionTimestamp > lastReadAt`**（无 attention 事件=不判未读，含刚导入/从未完结的会话——符合直觉，用户裁定）。
   - 打水位（open-agent.ts 双拍）**保持现状**（chatLastEventAt=max 打）：完结后 attention==max，水位≥attention → 已读；运行中 activity 涨 attention 不涨 → 不翻未读。时钟域纪律（F4，host 域）不变。
   - `chatLastEventAt` 仍用于排序/副标题，不改。
2. **双点收敛**（chat-list-row.tsx）：新增纯函数（derive.ts 导出，便于单测）`showsUnreadDot(bucket, pendingCount)`：bucket ∈ {running, needs_input, failed} → false（未读靠标题加粗；needs_input 的**计数 pill 保留**——pill 渲染条件是 count>0，与 dot 分开判定）；bucket=done/attention(空闲灰灯) → 未读时渲染 dot。
3. 无障碍标签（a11yUnread）逻辑跟 dot/加粗一致，勿漏。

## 范围

- 动：`src/shell/chats/derive.ts`（+derive.test）、`src/shell/components/chat-list-row.tsx`（dot 渲染条件）、`src/shell/chats/open-agent.ts`（仅当水位断言需更新）+ 对应 test
- 不动：notify/attention.ts（已是 attention 域）、官方文件、readState store 结构

## 工程约束

- 壳域；derive 保持 React-free 纯函数（vitest fixture 直喂）。
- 定向套件口径同 C17（W1 基线，批尾编排者全量对照）。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：derive.test 新增边界——①运行中 activity 多次推进不翻未读；②attention(finished) 推进翻未读；③从未打开+有 attention=未读；④从未打开+无 attention=不未读；showsUnreadDot 全 bucket×pendingCount 矩阵。
3. 真机：起一个长任务（codex 多轮）→ 离开会话观察：中间步骤**不**出蓝点；任务完结 → 蓝点+加粗出现；点进→清；等待批准会话 → 计数 pill 仍在（非 dot）。
4. 读图 ≥3 存 `paseo-go/evidence/C18/`（运行中无蓝点 / 完结有蓝点 / needs_input 计数 pill）。

- 恰好一次 commit；报告 JSON 四件套。
