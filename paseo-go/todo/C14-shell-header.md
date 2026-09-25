# C14 壳薄顶栏（C4 裁定分支：官方顶栏无注入点）

## 背景 / 用户拍板

C4 实证：WorkspaceScreen props 固定、WorkspaceHeaderMenuMobile 菜单项硬编码 JSX、PluginHeaderButtons=daemon 插件面——官方会话屏顶栏**无注入点**（不改官方文件前提下）。DESIGN §7 的"查看项目文件/停止/重命名"溢出菜单走 P1 壳薄顶栏分支。

## 设计裁定（照此执行，不得重开）

- 壳侧包一层：会话路由进入仍走官方屏（D2 不变），但**在壳的导航层叠一条薄顶栏**（高 ≤44dp，官方 token 配色）：返回｜标题（别名优先）｜⋯ 菜单（查看项目文件→push (shell)/files 带 workspace 参数；停止；重命名——全复用 `shellAgentActions`，禁用态矩阵复用 chatMenuPlan 精神）
- 叠加方式自选（壳路由组包 Stack header / 绝对定位浮层），硬约束：①不改官方文件 ②不与官方顶栏双重显示（探测官方顶栏在 compact 形态的可见性，若已隐藏则直接占位；若共存则薄顶栏改为底部工具条或替换返回区——以真机截图无重叠为准）③返回手势不被吞
- 状态灯进薄顶栏（复用 chat-status-light）

## 范围

- 动：`src/shell/components/shell-session-header.tsx`（新）、`(shell)/_layout.tsx` 或新增壳会话包装路由、routes.ts、locales
- 不动：官方源文件、两缝隙

## 工程约束

- R1 纪律全套适用（useShellHostStatuses、metro flag、force-stop 拉 bundle、CDP 取证）
- 发消息/收回复复验一次（codex 上游 502 若恢复则拿干净回复截图；仍 502 则记录并复现 error-turn 路径即可）

## 验收（四项证据契约）

1. typecheck+lint+oxfmt 零错误
2. 套件 stash 对照无新增失败；薄顶栏显隐逻辑单测
3. 真机：进会话→薄顶栏功能全验（返回/标题/三菜单动作）→无双重顶栏→返回手势正常
4. 读图：≥4 张（薄顶栏常态、菜单展开、查看文件跳转、无重叠证明）

- 恰好一次 commit
