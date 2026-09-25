# NOTIFY.md — C11 官方通知基建探源 + 壳实现路线

> 探源时间 2026-09-25，基线 `15dfd517`。探源问题：官方 app 是否已有 daemon→relay→FCM 推送管线？壳能否复用？后台可达性依赖什么？

## 1. 官方基建实况（探源结论）

官方 **已有完整推送管线**，四段：

| 段                    | 位置                                                                                                                                                                                                                              | 事实                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| daemon 事件→push 判定 | `packages/server/src/server/websocket-server.ts`（`broadcastAgentAttention` → `plan.shouldPush` → `pushNotificationSender.send`）                                                                                                 | agent attention（finished/error/permission）事件按客户端在场性判定是否推送；`packages/app/src/contexts/session-context.tsx` `notifyAgentAttention` 是前台 OS 通知的对应段 |
| token 注册 RPC        | `client.registerPushToken(token)`（session-context `startPushNotifications`）；daemon 端 `handleRegisterPushToken` 存 `paseoHome/push-tokens.json`                                                                                | 连接后自动注册，心跳 renew，removeHost 时 revoke                                                                                                                          |
| 发送通道              | `packages/server/src/server/push/push-service.ts` → `https://exp.host/--/api/v2/push/send`（Expo Push Service，批 100）                                                                                                           | **不是自建 FCM**，走 Expo 托管通道                                                                                                                                        |
| 客户端取 token        | `packages/app/src/push-notifications/internal/subscriptions.ts`：`getExpoPushTokenAsync({ projectId })`，projectId 取 `Constants.easConfig.projectId` / `extra.eas.projectId`（`app.config.js` 硬编码官方 EAS 项目 `0e7f65ce-…`） | Android 侧还要求 APK 内嵌与 applicationId 匹配的 `google-services.json`（`app.config.js` 从 `.secrets/google-services.{prod,debug}.json` 解析）                           |
| 点击路由              | `packages/app/src/app/_layout.tsx` `PushNotificationRouter`：payload 读 `serverId/agentId/workspaceId/terminalId` 四个键 → 官方 `navigateToAgent`（dismissTo 动词）或 `buildNotificationRoute` 兜底                               | 前台展示被其全局 `setNotificationHandler` 压掉（shouldShowBanner/List=false）                                                                                             |

## 2. 归类：b 半通 → 壳按 c 落地

- **a（壳直接复用官方后台推送）= 不通。** 三个硬门槛，每个都要动官方外资源：
  1. 本机无 `.secrets/`（实测目录不存在）→ 官方 APK 都没有 `google-services.json`，`getExpoPushTokenAsync` 在 Android 直接失败（subscriptions.ts 里还有 `Missing EAS projectId` 分支兜底）。
  2. 即便拿到官方凭据文件，其 Firebase 应用注册绑定 `sh.paseo(.debug)` 包名；壳包名 `app.paseo.shell.debug`（D3 独立包名）不在注册列表 → token 无效。要通必须为壳新建 Firebase/EAS 项目并把 FCM server 凭据上传到 Expo 项目 —— **官方 FCM 凭据申请，卡面明令停手项**。
  3. 发送端 daemon 的 push 目标是 Expo 项目 `0e7f65ce-…` 的凭据（getpaseo 账号），壳无权配置。
- **b（改官方文件即可通）= 不需要走**：官方管线本身完好，问题全在凭据，不在代码。
- **c（卡内降级路径）= 本卡实装**：app 进程存活期间（前台或已连后台）本地通知 + 壳 store 订阅 attention 跃变去重。

**边界（known_issue 口径）：锁屏/进程被杀后的后台推送依赖官方 Expo/FCM 凭据通道，壳无法自建，待官方为独立发行渠道提供凭据后再接回 `registerPushToken` 管线。** 设备侧另注意：本验证平板为华为（GMS 包存在但 FCM 连通性未验证），即使凭据齐备也需真机复测。

## 3. 壳实现（c 路径）

```
useAggregatedAgents（官方目录订阅，零新 RPC）
  └─ useShellNotifications（(shell)/_layout 挂载，全 tab 生效）
       └─ planAttentionEvents（纯函数：needs_input/failed 跃变 + 台账去重，attention.ts）
            └─ postAttentionNotification（service.ts：HIGH 通道 + 首次触发时请求权限 + scheduleNotificationAsync(trigger:null)）
                 └─ 点击 → openFromResponse → shellNavigateToAgent（C4 open-intent 通道，push 动词）
```

关键决策（都写进了源码注释）：

1. **payload 键名 `pgn/sid/aid/wid`，故意避开官方四键** → 官方 `PushNotificationRouter` 读不到目标，落 `/` 兜底；warm 点击时官方监听器先注册先执行（navigate "/" 回壳根），壳监听器随后 push 会话路由 → 返回键回对话列表。**冷启动**：官方与壳都读 `getLastNotificationResponseAsync`（实测原生 getter 不消费，`NotificationsEmitter.kt` 仅 `clearLastNotificationResponse` 清空），壳侧延迟 700ms 导航压后官方 redirect。
2. **前台展示**：官方全局 handler 压制一切前台显示；壳在 layout 挂载后（effect 顺序晚于根布局）覆盖安装自己的 handler——带 `pgn` 标记的展示、其余原样复刻官方压制行为，官方 push 语义不变。
3. **去重**：模块级台账（key→kind+stamp），同 agent 同状态只弹一次；needs_input↔failed 切换或更新的 attentionTimestamp 视为新跃变；进程首扫只登记不补发（等待中的会话已在「需要处理」分组可见）；主题切换导致 Tabs 重挂不重置台账。
4. **开关**：`paseoGo.settings.notifications` 默认开（zod `.default(true)` 保证旧 payload 不因缺键整包作废）；关闭期间台账冻结，重开即补告当前等待者。
5. **权限时机**：首次要发通知时才 `requestPermissionsAsync`（卡面裁定），拒绝后静默不再弹。

## 4. 后台可达性实测记录（2026-09-25，华为 BRT-W09 / Android 12）

- **前台（app 打开）= 可达 ✔**：agent 进入 failed 跃变 → 通知栏出现（标题=会话名「C11 等待批准」，正文=错误摘要 `运行出错：unexpected status 502 Bad Gateway…`，`evidence/C11/02-notify-failed-shade.png`）→ 点击直达会话（C4 open-intent 工作区路由 + tab 落位，`03-tap-lands-session.png`）→ 返回键回对话列表、该行未读已清。前台横幅被官方全局 handler 压制的问题由壳覆盖安装 notification handler 解决（带 `pgn` 标记才显示，其余复刻官方压制行为）。
- **home 退后台 = 本机不可达 ✘（实测）**：进程存活（pid 不变，doze 白名单已含 `app.paseo.shell.debug`），agent 在后台期间进入 error，但通知未发布——EMUI 冻结后台应用的 JS 线程/定时器（华为电池策略，白名单不覆盖此层，需用户手动开「允许后台活动」，不可编程保证）。**结论：后台/锁屏可达必须走 §2 官方推送通道；本地通知只保证前台可见** —— known_issue。
- **needs_input 真机端到端一轮未拍全**：codex `auto` 对 echo/网络均不升级权限、`read-only` 模式未在 daemon 0.9.2 AvailableModes 暴露、claude 订阅 403、opencode 未认证 → 本轮以 failed 跃变实测全链路；needs_input 与 failed 共用同一跃变管线（attention.ts 纯函数两桶均有单测）。留 C13 冒烟补拍。
- 基线纪律实测修正：目录快照分波到达（先摘要行、attention 字段后补丁），单纯首扫基线会把旧 failed agent 的字段补丁误判为新跃变补发；已加 注册表门 + host 集合重基线 + `fireFrom` 时效下限 三重防护（见 `attention.ts` 头注释），修复后冷启动/重载静默、真跃变照常发布。
