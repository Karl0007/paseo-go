# C31 平板双栏接线：三 tab body 抽取 + 右栏落位 + 选中态

## 背景 / 用户拍板

C30 骨架上的接线卡，机制=DESIGN-tablet.md §3.2/§7-C31。body 抽取复用 C16 files-screen-body 先例（git log d1b9596d）。

## 设计裁定（照 DESIGN-tablet.md 执行，不得重开）

1. **body 抽取 ×3**：chats/workspace/me 三屏把列表主体抽成 `src/shell/components/*-screen-body.tsx`（或 tablet 目录下包装，取改动最小），路由屏=薄壳（竖屏渲染 body 原样；宽屏时 body 渲染进 SplitHost 列表栏——机制按 §3.2：Tabs 仍在根 Stack，宽屏 tabBar 隐藏，(shell) 屏在右栏渲染为占位/null、body 经 SplitHost 消费，具体挂载姿势按 C30 落地结构定，**不得伪造 PaneContext**）。
2. **行点击→右栏**：会话行=现有 `shellNavigateToAgent`（零改动）；L2 工作区行=`shellFilesHref`；官方设置=既有 push——全部天然落右栏。
3. **选中态**=路由派生单一真相（当前 pathname/栈顶解析，纯函数+单测）：列表行高亮、轨项高亮。
4. **深链/冷启动**：`paseogo://` 冷启动带会话目标 → 右栏落会话、左栏回对话 tab；无目标 → 右栏空态占位屏（§4-9）。
5. **轨交互**：切 tab 保列表滚动位（body 不重挂为佳，做不到如实报告）；重复点=回顶（C30 桩接通）。
6. 未读/双拍、C18 完结制语义在宽屏路径上零变化（回归项）。

## 范围

- 动：`src/app/(shell)/{chats,workspace,me}.tsx`（薄壳化）、`src/shell/components/`（body 组件）、`src/shell/tablet/**`（接线+选中态纯函数+test）、locales（如需）
- 不动：官方文件；C21 胶囊/边缘带（C32）；C30 已定骨架结构（如需微调须报告说明理由）

## 工程约束

- **必须在 C17、C26 之后执行**（同文件 chats.tsx/workspace.tsx 基线）。
- BUILD.md #7/#8 纪律；定向套件口径同 C17。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：选中态纯函数矩阵（tab×pathname×无选中）+ 既有 chats/workspace 测试无新增失败。
3. 真机横屏：①点会话→右栏出官方会话+左列行高亮；②返回键→右栏回占位/上一个，列表不丢；③点 L2→右栏文件页；④深链冷启动落右栏；⑤轨切三 tab 正常、重复点回顶；⑥竖屏全功能零回退抽验（对话/工作区/我的各一屏对照）。
4. 读图 ≥8 存 `paseo-go/evidence/C31/`。

- 恰好一次 commit；报告 JSON。
