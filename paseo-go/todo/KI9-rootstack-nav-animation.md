# KI-9 二级屏迁根栈：统一 push 动画 + 切栏淡入 + 会话菜单收敛（用户拍板 2026-09-29）

## 用户裁定（原话口径）

1. 「这三个按钮（查看项目文件/查看 diff/打开文件浏览器）看上去会走向两个不同的页面，
   但是一个有动画一个没动画。理论上需要统一界面。」→ **ask 已拍板：收敛成两项**：
   「查看项目文件」→壳文件屏·文件页签；「查看 diff」→壳文件屏·diff 页签；
   **删除「打开文件浏览器」**（同一官方 explorer 引擎，容器冗余）。
2. 「现在我们新加的页面切换通通都没有动画，都需要有。」→ **ask 已拍板：
   push 滑入 + 切栏淡入**（二级屏=原生滑入；rail/底部 tab 三栏切换=淡入淡出）。

## 根因（编排者已钉）

files / import / commands-edit / rename 是**隐藏 tab**（C5 KI-2 形态，藏在 Tabs 里）→
tab 内切换天然无动画；而 (detail)/preview、(detail)/files 是根栈 push → 有动画。
两套容器=两种体验。C16 已实测：根栈 `(detail)` 组的 push 是真 push、返回语义干净。

## 实现口径

### 1. 迁移（结构主体）

- `src/app/(shell)/files|import|commands/edit|rename` → `src/app/(detail)/` 对应路径
  （git mv 保历史）；`(shell)/_layout.tsx` 删 4 个隐藏 `Tabs.Screen` 注册；
  `(detail)/_layout.tsx` 注册（headerShown:false，动画=根栈默认 slide）。
- `src/shell/routes.ts`：`SHELL.files/import/commandsEdit/rename` 常量改指 `(detail)` 组
  （**全局 pathname 不变**——group 前缀被剥离，`/files/…` `/import` 等串保持，
  `split-predicates` 的 section 派生与 `(shell)/_layout` 注释同步核）；
  `shellFilesHref` 与 `(shell)/files` 的 hidden 实例**合并删除**（C16 双实例收敛为单实例，
  工作区树行也 push (detail) 实例——原 hidden 实例的 navigate-to-workspace 返回逻辑
  换成 `router.back()` + canGoBack 兜底 `replace(SHELL.workspace)`，与现 (detail) 实例同款）。
- 全部调用点迁移：workspace-screen-body（文件行）、＋菜单（导入/指令）、rename 入口、
  深链恢复 recipe（paseogo://）回归。
- 各屏返回按钮：统一 `router.back()` + canGoBack 兜底（import 兜底=chats，files=workspace，
  commands-edit/rename=来源屏；语义与现状一致，只是动词换成真弹栈）。

### 2. 切栏淡入

- 宽屏：`TabletListColumn` 的 pane opacity 0/1 二值 → `Animated.timing`（~150ms）交叉淡入
  （keep-alive 结构不动，只把 opacity 变动画值）。
- 竖屏：Tabs 切栏——查 bottom-tabs v7 `sceneAnimationEnabled`（支持则开 fade）；
  不支持则记录实测结论并给替代（如 tabPress 后对内容层做 150ms opacity flash），不许假绿。

### 3. 菜单收敛（shell-session-header）

- 删「打开文件浏览器」行；「查看项目文件」/「查看 diff」都 `router.push(shellFilesHref(...))`，
  带初始页签参数 `tab=files|diff`。
- 文件屏接受**初始** `tab` query 参数（C27 裁定 4 增补：仅初始值，仍不入 persist、
  不进后续 URL 状态）；非法值回退 files（`resolveFilesScreenTab` 已兜底）。
- 官方 explorer overlay 路径（C21）若因此再无入口→删该分支代码；若他处仍用→保留并在报告注明。

## 验收（证据契约四项）

1. app typecheck + oxlint 零错误。
2. 定向：routes.test（新常量的 pathname 断言不变量）、files-tabs resolve(tab 参数)、
   既有 import/files 相关测试无新增失败；app 套件失败集=W1 基线零新增。
3. 真机（MatePad）：**逐屏连拍帧证明滑入**（文件/导入/指令编辑/重命名 各 push 前后帧）、
   切栏淡入（连拍 2 帧中间态半透明）、菜单只剩两项且落对应页签、硬件返回/边缘手势/深链回归、
   宽窄两态都过。
4. 读图 ≥5 存 `paseo-go/evidence/KI9/`。

## 风险与纪律

- 这是结构卡：迁移前后 `(shell)` 隐藏 tab 的**全部**引用点必须清零（grep `SHELL.import`
  `SHELL.files` 等旧路径 + `href={.*commands/edit}` 残留=0，报告附命令输出）。
- 与 KI-4（import 内容）/KI-5（import 接线）同文件域：本卡**排 KI-5 之后**；
  KI-6/7/8 排本卡之后。
- 恰好一次 commit；报告 JSON（含迁移清单+动画实测结论）。
