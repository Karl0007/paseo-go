# KI-16 会话页三条口径 + 长按阈值砍半（用户拍板 2026-09-30）

## 用户裁定（原话）

「会话页的问题按照我说的三条改，时间先砍半，在有成品之前不要再让我手动测试。」

三条口径（用户 2026-09-30 原话转写）：

1. **下拉刷新**：会话列表支持下拉刷新。
2. **长按弹选项窗**：长按一段时间后弹出选项窗；**现在时间太长——砍半**（500ms→**250ms**）。
3. **弹窗后拖动接力**：选项窗弹出后上下拖动 → 窗消失、转为拖动改序；
   普通会话**只有拖进置顶区才置顶**（普通拖动仅切换顺序）；置顶会话**拖出置顶区即取消置顶**。

## 现状事实（编排者已读码）

- 三条的机制在 KI-11/C20 已实现：接力状态机 `drag-menu-arbitration.ts`
  （pressing→armed(180ms)→menu_open(CONTEXT_MENU_DELAY_MS=500)→dragging(relay 8px)），
  置顶落点判定 `decidePinDrop/dispatchPinDrop`（113 单测在案）。
- 阈值两处路径：可拖行=仲裁机 `CONTEXT_MENU_DELAY_MS`（drag-menu-arbitration.ts:59）；
  归档/搜索行=Pressable 默认 `delayLongPress`（RN 内部 500，**未显式传参**——
  注释 drag-menu-arbitration.ts:52-58 明说这是巧合不是同源）。
- 下拉刷新：chats FlatList RefreshControl 在（KI-11 加了 gestureLock 防误触闸）。

## 实现口径

1. `CONTEXT_MENU_DELAY_MS` 500→**250**（用户指令"砍半"；注释记用户裁定日期）。
2. 归档/搜索行显式 `delayLongPress={CONTEXT_MENU_DELAY_MS}`（chat-list-row.tsx 的
   ContextMenuTrigger 路径；消灭"巧合 500"，单一真相源）。
3. 阈值联动核查：arm 180ms 保持（250>180 仍成立）；relay 8px/slop 6px 不动；
   钉时梯的测试（drag-menu-arbitration.test.ts / use-shell-row-drag-menu.test.tsx 的
   advance(500) 等）同步改 250 并保住不变量断言（菜单在 250 开、249 不开）。
4. 三条行为复核（读码+单测层面，真机帧归"新包端到端"任务，不在本卡）：
   - ①下拉刷新路径有测试钉（gestureLock 带内不触发）；
   - ③普通行拖入置顶区才 pin、区内改序不 pin、置顶行拖出区 unpin——
     decidePinDrop 用例若缺"区内改序不 pin"补上。

## 验收

1. typecheck/oxlint 零错。
2. 定向：时梯测试全绿（含 249/250 边界）；decidePinDrop 矩阵绿；app 套件失败集=W1∪C1 零新增
   （若与 KI-14 并行，全量归 Main 终态门禁，本卡只跑定向+shell 域）。
3. 真机帧=归新包端到端轮（用户红线：成品前不再手动测试；自动化帧由补证轮统一出）。
4. 恰好一次 commit（`feat(paseo-go): KI-16 ...`）；报告 JSON。

## 依赖

- 文件域：chat-list-row.tsx / drag-menu-arbitration._ / use-shell-row-drag-menu._ / chat-row-menu.tsx。
- 与 KI-15（workspace 域）不相交；与 KI-14（session-header/workspace-screen 域）不相交。
