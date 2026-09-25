# Paseo Go — C1 开工前置验证（DESIGN §10 A1-A4）

> 环境：MatePad BRT-W09（Android 12, AHPEBB1826005071）+ dev daemon（`.dev/paseo-home`，192.168.31.190:6767）+ metro（APP_VARIANT=development）。
> 壳 APK：`PASEO_GO=1 APP_VARIANT=development` → 包名 `app.paseo.shell.debug`，显示名 "Paseo Go Debug"（与官方 `sh.paseo`、debug `sh.paseo.debug` 三包共存）。
> 壳开/关实测：`EXPO_PUBLIC_PASEO_GO_SHELL=1`（metro 环境）→ 冷启直达三 tab；env 关 → 官方欢迎页原样。
> 结论速览：**A1 ✅ A2 ✅（附返回键注意）A3 ✅ A4 ✅**。证据图 `evidence/C1/`。

## A1 — host-runtime 多主机状态可在 (shell) 屏订阅：✅ 通过

- 做法：`src/app/(shell)/chats.tsx` 直接 import 官方 `@/runtime/host-runtime` 的 `useHosts` /
  `useHostRegistryStatus` / `useHostRuntimeSnapshot`，在 (shell) tab 屏内渲染主机
  label + 每主机 connectionStatus。无官方屏中介、无额外 provider。
- 证据：`02-shell-chats-probe.png` —— "主机 · A1 探针 · READY" 段显示
  `LAPTOP-K7UNLBKK · online`（实时订阅，注册表状态 ready）。
- 预案（@getpaseo/client 多实例）不需要。

## A2 — 官方 agent 路由可从 (shell) push 正常 bootstrap：✅ 通过（附返回键注意）

- 做法：chats 探针行 `router.push(OFFICIAL.agent(serverId, agentId))`（路由字符串收敛在
  `src/shell/routes.ts`）。官方 `h/[serverId]/agent/[agentId]` 自带 `HostRouteBootstrapBoundary`
  - agent lookup + 再导航到 workspace 会话屏，壳侧零配合代码。
- 证据：`03-shell-agent-route.png` —— 从壳 tab push 后官方会话屏完整加载
  （顶栏 `main paseo-go · LAPTOP-K7UNLBKK`、用户/回复消息、composer 齐备）。
- 注意 1（→ C4）：agent 路由是"解析桩"，解析后会 `navigate` 到
  `h/[serverId]/workspace/[workspaceId]`；从会话屏按**系统返回键**先落回桩屏（渲染 null，
  白屏一帧）再回壳。官方桌面端不暴露此路径（其历史栈不同）。C4 接线时壳内改用
  `navigateToAgent()` 同款目标（workspace 路由 + open intent）即可绕开。
- 注意 2：裸组路由 `/(shell)` 在运行时**不可导航**（Unmatched Route），seam 落地为
  `/(shell)/chats`（Tabs 的 initialRouteName 由 `paseoGo.settings.defaultTab` 决定）。

## A3 — FileExplorerPane 打开回调可覆盖为 Stack push：✅ 通过

- 代码级：`components/file-explorer-pane.tsx` `handleEntryPress` → 文件项 →
  `handleOpenFile` → `onOpenFile?.(entry.path)`（L553-573）。组件内部**没有**默认打开行为，
  "打开"完全委托调用方回调 → 壳传 `onOpenFile={(p) => router.push(...)}` 即天然覆盖。
- 真机级：`src/app/(shell)/workspace.tsx` 临时挂载真 `FileExplorerPane`
  （serverId + workspaceId + repoRoot），回调写入屏上状态。
- 证据：`04-shell-workspace-a3.png`（真实目录树渲染，排序/工具条齐备）与
  `05-shell-a3-opened.png`（点 `.oxfmtrc.json` 后绿色横幅
  "onOpenFile 已触发：.oxfmtrc.json —— 回调覆盖为 Stack push 可行"）。
- C6 走向：可直接嵌官方 FileExplorerPane + Stack push 预览，**无需**自绘轻量树
  （+2-3 天预案不启用）。

## A4 — agent status 字段足以渲染四态状态灯：✅ 通过（1 项补测说明）

- 数据面：`AggregatedAgent`（`useAggregatedAgents`）携带
  `status`（协议 `AGENT_LIFECYCLE_STATUSES` = initializing/idle/running/error/closed）、
  `turn.phase`（idle/open）、`requiresAttention`、`attentionReason`（finished/error/permission）、
  `pendingPermissionCount`。
- 官方现成派生：`deriveSidebarStateBucket`（@getpaseo/protocol/agent-state-bucket）→
  `needs_input | failed | running | attention | done`；`AgentStatusDot` 组件直接消费上述字段，
  壳探针原样复用 + 屏上打印原始 payload。
- 证据：`02-shell-chats-probe.png` agent 行 ——
  `status=idle · turn=idle · attention=finished · pending=0`（绿点，完成态）与
  `status=error · turn=idle · attention=error · pending=0`（红点，codex 探针 502 真实错误态）。
- 映射到设计四态：🟢运行=running｜🟠等待批准=needs_input/attention(permission)｜
  ⚪空闲/完成=done｜🔴出错=failed(error)。字段齐备。
- 补测说明（非失败）：本轮真机未自然产生 needs_input（等待批准）实例（探针任务无权限请求）；
  字段与官方桶函数在代码层齐备，C2 列表实现时用一条会触发权限请求的会话补一次真机确认。

## 附 1：品牌图标（D3）

- 源：`paseo-go/assets/icon.svg`（G 起笔成纸飞机镖；官方色系：白 glyph）。
- 生成：`node paseo-go/assets/build-icons.mjs` → `icon.png`（1024，暗底 #0B0F0C，iOS/遗留启动器）、
  `android-icon-foreground.png`（透明底白 glyph）。
- 自适应：adaptiveIcon 背景 `#20744A`（官方 accent）+ 白前景 + `monochromeImage` 层
  （Android 13+ 主题图标，亮/暗由启动器着色）。
- ⚠ 已知：SDK 54 `@expo/prebuild-config` **不处理** `adaptiveIcon.dark.*`（写了不生成
  values-night 覆盖，已实测），故"亮/暗两版"落地为 monochrome 主题层方案，见 known_issues。

## 附 2：共存与开关矩阵（真机）

| 状态                                                            | 结果                                | 证据                                 |
| --------------------------------------------------------------- | ----------------------------------- | ------------------------------------ |
| 官方 sh.paseo / sh.paseo.debug 装 + 壳 app.paseo.shell.debug 装 | 三图标共存，壳图标=绿底白 G 镖      | `06-launcher-three-apps.png`         |
| 壳 app + flag 关                                                | 官方欢迎页原样                      | `07-shell-app-flag-off-official.png` |
| 壳 app + flag 开                                                | 三 tab 骨架（对话/工作区/我的，zh） | `02/04/08`                           |
| debug 包 flag 关                                                | 官方首页/侧栏原样（含既有会话恢复） | `01-official-home-flag-off.png`      |
