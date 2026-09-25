# C4 对话详情接线（D2 整路由直挂）

## 背景 / 用户拍板

DESIGN.md §7。基线 = C3 HEAD；C1 spike A2 已证明可 push。

## 设计裁定（照此执行，不得重开）

- 点击 → `router.push(OFFICIAL.agent(serverId, agentId))`；返回手势/物理返回回列表且列表状态保留（不闪刷）
- 进入会话 → `readState.markRead`
- 顶栏溢出菜单：官方路由支持注入则注入（查看项目文件→push `(shell)/files` 对应目录；停止；重命名=别名）；不支持则记 known_issue 排 P1 壳薄顶栏——**不为此改官方文件**
- 返回时该行状态即时更新（运行→空闲）

## 范围

- 动：`src/app/(shell)/chats.tsx`、`src/shell/**`
- 不动：官方 agent 路由及其组件源文件

## 工程约束

- 路由参数编码走 routes.ts 构造函数，禁止手拼字符串
- **C1-spike A2 结论**：直接 push `/h/[serverId]/agent/[agentId]` 后系统返回键先落 agent 解析桩（null 白屏一帧）再回壳。接线改用 **workspace 路由 + open intent**（官方 `src/utils/navigate-to-agent/index.ts` 工具族，详见 SPIKE.md），进会话与返回必须无白屏帧

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿（routes 编码单测：特殊字符往返）
3. 真实运行：进会话→发消息→收回复→返回→未读清、状态更新、列表位置不跳
4. 读图：≥3 张（会话全屏、菜单展开、返回后列表态）

- 恰好一次 commit

## 收卡记录（C4 实施，2026-09-25）

- **navigateToAgent 官方 navigate 动词不可用（实测）**：官方 `navigateToAgent` →
  `navigateToHostWorkspaceRoute` → `router.dismissTo`，dismissTo 会 **pop 掉 chats 屏**，
  系统返回键直接退出 app（真机复现）。壳改用官方工具族的纯函数层
  （`resolveNavigateToAgent` + `navigateToWorkspacePure`，`src/shell/chats/shell-navigate-to-agent.ts`），
  仅 navigate 动词换成 `router.push`：workspace 路由 + open intent（tab reveal）不变、
  不碰解析桩、返回键弹回列表（连拍+CDP rAF 双证无白屏帧）。
- **顶栏溢出菜单注入点探测结论：不可注入 → known_issue（排 P1 壳薄顶栏）**。
  证据：`WorkspaceScreen` props 固定（serverId/workspaceId/isRouteFocused/recoveryRequested，
  workspace-screen.tsx L255-260）；`WorkspaceHeaderMenuMobile` 菜单项为硬编码 JSX
  （workspace-header-menu.tsx L216-300），无 props/contexts/registry 注入面；
  `PluginHeaderButtons` 走 daemon 插件系统，非壳侧注入点。未改任何官方文件。
- 进会话 markRead（按压即打点）+ 返回聚焦再打点（会话内看到的回复不会返回后重新冒未读），
  逻辑在 `src/shell/chats/open-agent.ts`（单测覆盖触发时机）。
- 路由字符串：`OFFICIAL.agent`（解析桩）删除；新增 `OFFICIAL.workspace`/`OFFICIAL.agentOpen`
  （官方 host-routes 构造函数薄包装），编码往返单测 `src/shell/routes.test.ts`。
