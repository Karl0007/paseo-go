# KI-3 暗色冷启动：壳底部 tab bar 保持亮色快照（C12 发现）

## 现象（真机实测）

`我的 → 主题=深色` 保存后 force-stop 冷启动：三 tab 屏体、顶栏、列表全部暗色，
唯独底部 tab bar（背景+图标+非选中文字）保持亮色快照，连接完成后仍不复原。
运行时在壳内切「深色」则整壳（含 tab bar）即时变暗——即**只在冷启动路径失效**。
证据：`evidence/C12/d6-coldstart-dark-tabbar-fixed.png`（白 tab bar 冷启动帧）、
`evidence/C12/d2-chats-dark.png` / `d3-workspace-dark.png`（运行时切换后全暗对照）。

## 根因线索（C12 已排查）

- tab bar 颜色来自 `(shell)/_layout.tsx` 的 `withUnistyles(ShellTabsBase)` mapProps
  快照 + `styles.tabBar`（surface0/border token，无硬编码）。
- 冷启动时序：官方 appearance store rehydrate → `UnistylesRuntime.setTheme` →
  `AppearanceStyleBoundary` 重挂 navigator **下方**内容（变暗），但 navigator 自身
  chrome 的 mapProps 快照未随订阅更新（R1 同族的 React Compiler memoisation 类）。
- 两次修复尝试均实测无效（已回退，未入库）：
  1. 组件内 `useUnistyles()` 钩子订阅——被 `docs/unistyles.md` 的 useUnistyles 禁令
     否决（pre-commit lint 拦截），且未证明能解决时序；
  2. 用官方 settings store + `useColorScheme` 派生 `themeKey` 重挂 Tabs——冷启动
     实测白 bar 依旧（key 变化早于 setTheme 提交，重挂时 Unistyles 仍是亮色；
     且 docs/unistyles.md §350 明令「Do not add local appearance keys or a boundary
     above a navigator」）。

## 待试方向（>半天，勿在打磨卡硬塞）

- 对齐官方 navigator chrome 的更新通道（`docs/unistyles.md` §349「tracked native
  styles + themed leaf props update in place」为何对本 Tabs 失效——查 unistyles
  3.2.4 本地 patch 是否裁掉了 navigator 订阅）。
- 或冷启动在 setTheme 提交后再挂 navigator（splash gate），代价是首帧变慢。

## 影响面

仅「保存了深色覆盖 + 冷启动」场景的底部条；系统深色（theme=auto）走原生
scheme 首帧即暗，不受影响。发布前若未修，至少在 release note 注明。
