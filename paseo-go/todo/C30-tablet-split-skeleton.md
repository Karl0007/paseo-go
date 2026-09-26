# C30 平板分栏骨架（ShellTabletSplitHost + 导航轨 + 触点贴缝）

## 背景 / 用户拍板

Q10 平板横屏 IM 范式，设计定稿=`paseo-go/DESIGN-tablet.md`（C29 交付，编排者已按 §14.11 批准 T-A 案，DESIGN §14.13 在案）。用户预授权直接落地，事后审。

## 设计裁定（照 DESIGN-tablet.md 执行，不得重开）

- 机制=§3.2 T-A：`packages/app/src/app/_layout.tsx` AppShell（929-942）用 `ShellTabletSplitHost` 包 AppContainer。**触点预算：净增 ≤10 行**（预期 import 1 + 包装 2，其余为缩进）；单包装点零逻辑；merge 解缝=重新贴缝。
- 新代码全在 `src/shell/tablet/**`：激活谓词纯函数（壳模式 && !isCompact && !full-bleed→否则透传 children 原样返回）、`ShellTabletSplitHost`（左列=导航轨+列表栏占位，右栏=AppContainer）、导航轨（对话/工作区/我的 三项，图标复用 (shell)/\_layout 同源 lucide；重复点当前项=回顶事件先留桩）、宽屏 tabBar 隐藏（`(shell)/_layout.tsx` 条件 display:none，Tabs 骨架/隐藏屏/lastFocusedTab 语义不动）。
- 列表栏本卡=占位（渲染活动 tab 名+空态占位屏）；真实 body 接线=C31。尺寸常量按 §4 表（轨 56/64、列表 260/300、详情 min 400、内容 max 820）。
- React Compiler 纪律：谓词纯函数+单测，禁 void-version（R-1）。KI3 冷启动族：pending 门控姿势，冷启动横屏暗色截图为验收项（R-2）。

## 范围

- 动：`packages/app/src/app/_layout.tsx`（仅 AppShell 包装点）、`src/shell/tablet/**`（新）、`src/app/(shell)/_layout.tsx`（tabBar 隐藏条件）、locales（轨三项复用既有 tabs.\* key，零新 key 为佳）
- 不动：三 tab 屏本体（C31）、C21 胶囊（C32）、官方其它文件

## 工程约束

- 环境坑纪律：BUILD.md #7（提交=rm `packages/app/.expo/types/router.d.ts` 后立刻 pathspec 提交）、#8（一切 cwd 大写盘符）；定向套件口径同 C17；禁跑全量。
- 竖屏零回退=硬验收（§6 断言表逐条对图）。

## 验收（四项证据契约）

1. 门禁零错误（触点后全仓 typecheck 必查 `_layout.tsx` 无残留错误）。
2. 定向绿：激活谓词/透传逻辑单测（compact×shellMode×full-bleed 矩阵）。
3. 真机（横竖屏切换用 `adb shell cmd display set-orientation` 或自动旋转实测）：①横屏=轨+列表占位+右栏三列，竖屏截图与 HEAD 基线**逐屏零差异**；②转屏往返无导航栈丢失；③冷启动横屏暗色正常；④壳模式关=官方 IA 横屏零变化；⑤官方包（sh.paseo.debug）不受影响（同 bundle 逻辑上 seam=false 透传，抽验一屏）。
4. 读图 ≥6 存 `paseo-go/evidence/C30/`（含竖屏基线对照）。

- 恰好一次 commit；报告 JSON（触点 diff 原样贴出）。
