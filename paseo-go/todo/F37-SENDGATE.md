# F37 导入/外部会话：打开即同步+发送才警告（用户拍板 2026-10-06）

## 用户诉求（推翻 C24 弹窗位置）

1. 点开会话**不弹任何对话框**（打开=只读永不分叉，C24 已取证；弹窗放错了地方）。
2. 打开导入会话**立刻看到电脑上最新进展**（现状=快照，要手动长按刷新）。
3. **发送消息那一刻**才警告可能分叉（现状=静默分叉，最该警告处没警告）。形态拍板=**警示条+二次发送确认**。

## 裁定口径（v2——链路深查后修正；v1 的服务器发送门与警示条**作废**，理由见下）

**取证修正**：①发送守卫**早已存在**（B4-R4 `shell/composer/ownership-send-guard.ts` 包装组合器唯一出口 sendAgentMessage，external·running 直发弹「仍要发送」=用户拍板要的形态）；用户没见过只因被打开侧弹窗拦住。②R4-open 门注释的前提「打开官方屏=resume=分叉」被今日实证推翻（d6484fa journal 零 mount 行=daemon 从未因打开拉起进程；C24 卡自证「只读+刷新永不分叉」）。③会话屏胶囊已显示「外部·运行中」（B5-OWNVIS），环境警示已有，加横幅=噪音。④服务器门与客户端守卫会形成双重拦截（弹窗后还要二次发送）——回滚。

**最终范围=纯减法+一小增量**：

1. 删 C24 打开弹窗：open-agent.ts fork 门+deps+forkAck store+clear-local-data 注册+locales chats.fork.\*+相关测。
2. 删 R4-open 门（打开不再拦；**发送守卫原样保留**=唯一警告点，语义与文案不动）。
3. 打开自动同步：会话屏宿主（shell-session-header 挂载效应）对带 `paseo.imported-provider-session` 的聚焦 agent 静默 `refreshAgent` 一次/聚焦（失败静默）。
4. 真机验收：打开无弹窗+直接见最新；发送弹「仍要发送」；取消不丢草稿（守卫既有语义）。

## ~~v1 原口径（存档）~~

- **撤**：C24 打开弹窗（open-agent.ts fork 门）+ forkAck store（连同 clear-local-data 注册与三处 deps 接线）——干净拆除。
- **打开自动同步**：会话屏聚焦的 agent 带 `paseo.imported-provider-session` → 挂载时静默 `refreshAgent` 一次（每聚焦一次；失败静默，不打扰）。
- **发送门（daemon）**：`send_agent_message_request`（仅 app 组合器入口；MCP/schedule/automation 路径不拦）在 ownership=external **且** externalLooksActive 时：第一次发送拒绝，error 文案=「源会话可能仍在电脑上运行，发送会产生分叉；再发送一次即确认继续（send again to confirm）」，并当场登记该 agent 已确认（内存 Set，daemon 重启即清）；第二次放行。live-held 与 stored 同一判据（live.ownership 优先，回落 record）。
- **警示条（壳）**：会话屏浮层（C14 Portal 基建同宿主）：同判据（external+looksActive）显示顶栏下细条「⚠ 源会话可能在电脑上运行 · 从 app 发送会产生分叉」，条件解除自动消失；不拦截。
- 边界：非外部会话零影响；gate 只读判据不新增 RPC；文案 zh 主 en 附（error 字符串直达组合器提示）。

## 验收

- 服务器测：首次拒+二次放行+非外部直过+live/stored 两态；manager 语义单测。
- 壳测：fork 门拆除后打开路径回归；警示条可见性判据；refresh-once 守卫（同焦不重复刷）。
- 真机：导入运行中会话 → 打开无弹窗、直接见最新；pill 外部·运行中时顶栏下警示条在；发一条→聊天流出现拒发提示；再发→成功且源会话分叉（如实）；警示条在源静默后消失。
