# C20 长按窗→滑动拖拽接力（全行接入）

## 背景 / 用户拍板

用户：「长按之后弹出一个手指旁边的小窗。然后长按的时候如果滑动，那这个小窗消失，然后改为修改排序。」取证：`use-shell-row-drag-menu.ts` 在 `menuOpenedRef=true` 后 `handleTouchMove` 直接 return——窗开后滑动是死区；非置顶行走引擎原生长按根本不能拖。裁定 DESIGN §14.4。**依赖 C19 已落（popover 形态）**。

## 设计裁定（照此执行，不得重开）

1. **状态机加边**：`menu_open + 距锚点移动 > 10px` → `menuController.setOpen(false)` + `drag()` + 触觉一次；同一触摸流内完成，不得要求重新长按。判定逻辑抽成**纯函数**（新 `src/shell/components/drag-menu-arbitration.ts` 或并入现有 hook 文件导出）供 vitest。
2. **全行接入**：非置顶行也走 `useShellRowDragMenu`（ContextMenu 禁原生 mobile 触发——引擎支持"disable mobile triggering on draggable rows"，找该 prop）；置顶行既有行为不回退。
3. **拖拽语义**：非置顶行拖落 = **置顶并插入落点**（pins store：新增/扩展 action，落点索引换算含分组偏移）；置顶行=组内换位（既有 reorderPinned）；落点越界钳制在置顶组内（既有）。搜索态拖拽仍禁（既有纪律）。
4. arm 时序保持 180ms/菜单 500ms（已实测值）；接力阈值 10px 与 arm slop(4px)/菜单 slop(6px) 的关系写进注释。
5. 注入纪律：真机拖拽测试 ≥50px/s（如 350px/7000ms），`input motionevent` 不可用（BUILD.md §4）。

## 范围

- 动：`src/shell/components/use-shell-row-drag-menu.ts`（+纯函数模块+test）、`chat-list-row.tsx`、`chats.tsx`（drag 落点处理接新语义）、`src/shell/stores/pins.ts`（+test：拖入落点=pin+insert）
- 不动：菜单条目内容（C24 再改）、C19 的呈现层结论（发现 popover 关窗与 drag 起手势冲突如实报告，最小调整在 hook 侧）

## 工程约束

- DraggableFlatList 已依赖+patch，勿升版；官方 sidebar 同款仲裁函数可复用（`sidebar-gesture-arbitration`）。
- 定向套件口径同 C17。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：纯函数状态机全路径（press→arm→menu→move→drag、menu→tap 选择、move-before-arm→scroll 等）；pins 新 action 单测；既有 drag 测试不回退。
3. 真机：①置顶行 长按→窗→滑→窗关→拖起→换位成功；②非置顶行同链→落置顶组指定位；③窗开轻点选择仍执行动作；④下拉刷新共存；⑤慢速滚动不误触发。
4. 读图 ≥5 存 `paseo-go/evidence/C20/`（窗开态/拖起态/落位后列表）。

- 恰好一次 commit；报告 JSON。
