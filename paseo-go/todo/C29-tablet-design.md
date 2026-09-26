# C29 平板横屏设计卡（纯文档，不改代码）

## 背景 / 用户拍板

用户：「横屏使用的平板，结构要优化，特别是会话页面；参考平板微信/QQ/飞书的聊天布局。你先自行出一版设计。」+「设计/实现/验证都可以交给子 Agent。」预授权（DESIGN §14.11）：出稿后**按编排者推荐直接拆实现卡落地**，设计文档留档事后审。

## 现状事实（已钉，直接采用）

- 宽屏判定=Unistyles breakpoint（`useIsCompactFormFactor`：xs/sm=compact，layout.ts:42-45）；MatePad 横屏=宽屏。
- 现状横屏=壳底部三 tab（竖屏 IA）+ 会话全屏 push + 官方根布局自动挂 desktop LeftSidebar（\_layout.tsx:540-555）→ 三套结构叠罗汉=用户看到的"乱"。
- 官方宽屏设施：SplitContainer、floating-panels、mobile-panels、desktop 三栏（sidebar+workspace+explorer）——官方 web/desktop 本身即 master-detail。
- 壳既有：三 tab 屏（chats/workspace/me）、(detail) 真栈预览/文件、C21 顶栏胶囊（其落地形态是本设计输入）。
- 硬约束：壳代码去处 `src/shell/**`+`(shell)/**`+`(detail)/**`；上游缝隙预算见 DESIGN §2.1+§13.1+§14.1；**官方会话屏=路由级组件**，"渲染进右栏"若需动根 `_layout.tsx`=新上游触点，必须在本设计稿中作为**显式提案**（含行数预算、merge 解缝口径、回退案），不得默认发生。

## 交付物：`paseo-go/DESIGN-tablet.md`

1. **目标与非目标**（横屏平板 IM 范式；不动竖屏/手机形态=非目标）。
2. **断点与形态矩阵**：xs/sm=现状竖屏壳（不变）；md/lg/xl=新平板形态；转屏行为。
3. **结构定稿（推荐案 + 一个备选，各给代价）**：导航轨（三 tab 去向）× 列表栏 × 详情栏；会话打开=右栏渲染官方会话路由的**具体机制**（候选：根 Stack 双栏化 / (shell) 组内 SplitContainer / 官方 LeftSidebar 复用改造——逐个对缝隙预算的冲击）；工作区三层树与文件屏在右栏的形态；「我的」形态。
4. **微信/飞书对齐点清单**（列表选中态、未读、返回语义、键盘避让、横屏分栏比例与最小宽度）。
5. **上游触点提案表**（若有）：文件/行数/理由/解缝口径/回退案。
6. **迁移与回退**：竖屏零回退断言；风险清单（React Compiler memo、Unistyles 冷启动 KI3 族、Portal 层序）。
7. **拆卡草案**：实现卡 2-4 张（文件域+验收要点），供编排者直接立项。

## 验收（设计卡裁剪）

- 无代码改动；文档自洽（每个结构决定能回答"手机竖屏为何不受影响"）。
- 恰好一次 commit（仅文档）；报告 JSON：per_item=上述 7 节 + known_issues。

## 验证记录

- 2026-09-27 设计稿已交付：`paseo-go/DESIGN-tablet.md`（7 节齐；推荐案=根级分栏宿主，唯一新触点提案 `_layout.tsx` 净增 3 行含回退案；拆卡草案 C30-C32；零代码改动）。
