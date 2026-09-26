# C33 重命名独立屏化 + 行长按/胶囊⋯ 转 popover（C19 遗留两步）

## 背景 / 用户拍板

C19 实锤：壳的长按菜单与胶囊 ⋯ 内嵌 `ChatRenamePage`（MenuTextField 子页，chat-row-menu.tsx:84-131），引擎硬约束「含输入框的页必须是 sheet」（docs/menus.md）。C19 按卡保留这两个菜单为 sheet——但用户 Q3 原话点名的正是「长按之类的逻辑在屏幕下方弹窗」。**裁定：把 rename 从菜单子页改成独立屏，菜单去掉输入页后转 popover**，与主流 IM 一致（上下文菜单=锚定小窗；重命名=表单页）。

## 设计裁定（照此执行，不得重开）

1. 新壳路由 `(shell)/rename`（隐藏 tab，同 files/commands/import 模式）+ `routes.ts` 加 `SHELL.rename` + href builder（agentKey 走对象 params）；屏体=标题+TextInput+保存/取消（姿势抄 `commands/edit.tsx`，主题 token，React-free 校验复用 `shellAgentActions.rename` 语义：空=清除别名）。
2. `chat-row-menu.tsx`：删除 MenuTextField rename 子页；rename 菜单项 onSelect → 关菜单 + push rename 屏（经注入回调，保持可测）。`ChatRenamePage` 组件退役删除。
3. `shell-session-header.tsx`：同样改 push；菜单矩阵 rename 项语义不变（enabled 恒真）。
4. 两个菜单去 sheet 例外：改 `compactMode="popover"`，删 C19 留的 sheet 例外注释。
5. 返回语义：rename 屏返回=不保存退出（Android BackHandler + 头部返回，同 commands/edit 姿势）。
6. **C20 接力复验（C20 移交，必做）**：行菜单转 popover 后复跑"长按→(pending-open)窗→滑→拖"全链
   （popover 同为 MenuOverlay Modal，C20 的 pending-open 姿势预期不变——实测确认；注入速度纪律 ≤10px/s，
   BUILD.md 补一行）；接力行为若因形态变化破坏，hook 侧最小调整并报告。

## 范围

- 动：`src/app/(shell)/rename.tsx`（新）、`src/shell/routes.ts`（+test）、`src/shell/components/chat-row-menu.tsx`（+test）、`shell-session-header.tsx`（矩阵 test）、`src/app/(shell)/_layout.tsx`（隐藏屏注册）、locales
- 不动：shellAgentActions 本体（rename 语义现成）、官方文件、C19 已完成的其余菜单

## 工程约束

- 依赖 C19 已落（popover 基线）。BUILD.md #7/#8 纪律；定向套件口径同 C17。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：routes.test（rename builder）、菜单矩阵 test（rename 项存在且 onSelect 走注入回调）、rename 屏保存/清除/取消逻辑（可测半区抽出）。
3. 真机：①行长按=锚定 popover（不再底部 sheet）；②点重命名→独立屏，改名→回列表标题变别名；③空提交=清除别名；④胶囊 ⋯ 同链；⑤返回键不保存退出；⑥搜索过滤下重命名不受影响。
4. 读图 ≥5 存 `paseo-go/evidence/C33/`。

- 恰好一次 commit；报告 JSON。
