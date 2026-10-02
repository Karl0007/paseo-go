# B8-SWIPE 统一横滑状态机：tab 环循环 + 堆叠页全宽返回（F26+F27）

## 口径（用户拍板，方向已确认）

一个手势协调状态机服务两裁定（同域，勿拆两人打架）：

1. **F26 tab 线性环**：`[进行中 → 已归档 → 工作区 → 我的 → (循环)进行中]`。**前进=切右边页签的手势**（手指左滑），**后退=手指右滑**；双向循环、带跟手动画。段内滑（进行中↔已归档，现 `shell/chats/filter-swipe.ts`）并入此环，不再两套手势打架。
2. **F27 堆叠页全宽返回**：所有 `(detail)` push 路由（会话/文件/预览/导入/重命名/命令编辑/主机设置/添加项目…，**非搜索态**）内**手指右滑=返回上一层**，不限左缘 80dp（现 `shell/session-header/edge-swipe.ts` 仅边缘触发）。堆叠页上手指左滑**不**切 tab（返回栈优先）。
3. **全局语义统一**：手指右=返回/后退；手指左=tab 环前进（仅根 tab 生效）。

## 冲突审计（卡内必做，逐项帧或测）

- 横向可滚子视图（代码块/图片/横向 FlatList）**声明性豁免**，不被返回劫持。
- 与垂直滚动、长按拖拽（置顶）、下拉刷新、搜索态互斥——沿用 B4-SWIPE 8 项清单扩展。
- 官方会话屏滚动体=上游组件，壳手势层能覆盖多大范围以实测为准；挂不住的部分**保留左缘带兜底** + known_issue 如实报。

## 文件域

- 新增 `packages/app/src/shell/gestures/**`（协调器/状态机）；改 `(shell)/_layout.tsx`、`shell/chats/filter-swipe.ts`、`shell/session-header/edge-swipe.ts`、`(detail)` 壳层。
- 独占设备道（本卡最后跑，手势帧最重，避免被别卡覆盖）。

## 验收

- 状态机单测：环双向循环、豁免判定、堆叠页返回优先。
- adb swipe 真机帧：环 4 步前进 + 1 步后退循环 + 2 个堆叠页全宽返回 + 1 段横向可滚内容**不被劫持**（反证帧）；帧存 `paseo-go/evidence/B8-SWIPE/`。
- scoped：`npx vitest run src/shell/gestures src/shell/chats src/shell/session-header` 绿 + typecheck + oxlint。**恰好一次 commit**。
