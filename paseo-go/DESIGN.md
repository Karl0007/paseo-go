# Paseo Go — 设计冻结文档（唯一真相）

> 状态：已冻结（2026-09-25）。所有任务卡验收口径只认本文档。
> 上游：getpaseo/paseo @ db4fd334（v0.9.2 线）。同步策略：`git merge upstream/main`，缝隙文件冲突人工 30 秒解决。

## 0. 一句话

手机优先的 Paseo 壳 app「Paseo Go」：叠加式 fork，零修改上游组件代码，三 tab 信息架构（对话/工作区/我的），Stack 导航替代桌面标签页，复用官方全部富组件与主题体系。

## 1. 用户拍板记录

| #   | 裁定             | 原话/结论                                                                                            |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| D1  | 收藏夹语义       | 收藏文件是基础；**追加收藏快捷指令**（一键执行预设任务）                                             |
| D2  | 对话详情复用深度 | 整路由直挂官方 `h/[serverId]/agent/[agentId]`                                                        |
| D3  | 品牌             | **Paseo Go** + 独立包名 `app.paseo.shell`（与官方共存安装）                                          |
| D4  | 范围             | P1 全部要做（拖拽排序/内容搜索/推送通知/会话导入/添加到对话），先最小闭环后逐个补齐，不许偷懒        |
| D5  | 语言             | 中英双语，走官方 i18n 设施                                                                           |
| D6  | 设计自主权       | 线框图只是示意；交互按成熟产品范式自行设计（长按置顶/归档/拖拽等），当作独立开发的 app，保证美观一致 |

## 2. 架构不变量（铁律）

1. **缝隙恰好两个**（超出即违规，总验收核对）：
   - `packages/app/src/app/index.tsx`：+≤5 行，flag 为真时 `<Redirect href="/(shell)" />`
   - `packages/app/app.config.js`：env `PASEO_GO=1` 时覆盖 name/applicationId/图标（≤15 行）
   - 运行时开关：壳设置页可切换 shell 模式（存 `paseoGo.settings.shellMode`，seam 优先读运行时值，其次 env）
2. **新代码去处**：路由 `packages/app/src/app/(shell)/**`；逻辑 `packages/app/src/shell/**`（stores/config/routes/components）。
3. **路由字符串收敛** `src/shell/routes.ts`（唯一出处）：
   ```ts
   SHELL = {
     root: "/(shell)",
     chats,
     workspace,
     me,
     files: "/(shell)/files/[serverId]/[workspaceId]",
     preview: "/(shell)/preview",
     commandRun: "/(shell)/run",
   };
   OFFICIAL = {
     agent: (sid, aid) => `/h/${sid}/agent/${aid}`,
     hostSettings: (sid) => `/h/${sid}/settings`,
   };
   ```
4. **i18n 零缝隙**：壳文案放 `src/shell/locales/{zh,en}.json`，运行时 `i18n.addResourceBundle` 注入，**不改上游 locale 文件**。
5. **主题零缝隙**：全部用官方 Unistyles 主题 token；禁止硬编码色值。
6. 本地状态：zustand + AsyncStorage persist，key 前缀 `paseoGo.`。Store 清单：`pins`（置顶+排序）、`archive`、`favorites`（文件）、`commands`（快捷指令）、`readState`（会话已读时间戳）、`settings`。
7. 上游同步纪律：`git merge upstream/main`；缝隙文件冲突时以"重新贴缝"为原则；`src/shell/**` 与 `(shell)/**` 永不冲突。

## 3. 信息架构

```
底部 Tabs: [对话] [工作区] [我的]
对话  ──push──> 官方 agent 全屏会话路由（D2）
工作区 ──push──> 文件浏览屏 ──push──> 预览屏（图片/视频/代码/md/html/二进制）
       ──push──> 官方 host settings / new workspace / onboarding 流程
我的  ──push──> 官方设置页 / 壳设置 / 关于
```

Android 返回键/手势 = Stack pop；tab 间不叠栈。

## 4. 对话 tab（参考微信/Telegram/Linear Inbox）

- 顶栏：连接状态胶囊（`n/m 主机在线`，点开=各 host 状态+重试）｜搜索 icon｜＋菜单（新建对话/导入会话）
- 分组：**已置顶**（长按拖拽排序）→ **需要处理**（等待批准，排序加权）→ **进行中/最近**
- 行结构：provider 图标｜标题（未读加粗+角标）｜副标题 `workspace · 相对时间 · 最后动态`｜状态灯
- 状态灯（数据源=协议 agent status）：🟢运行(呼吸)｜🟠等待批准｜⚪空闲｜🔴出错
- 未读：壳本地 `readState.lastReadAt`，进入即清
- **长按原生菜单**：置顶/取消置顶 · 重命名(壳本地) · 归档 · 停止 · 删除(带确认)
- 归档默认隐藏，顶栏筛选切换；下拉刷新；冷启动骨架屏；离线 host 置灰分组+重试
- 空态：插画+「新建对话」引导

## 5. 工作区 tab（参考 iOS Files/微信收藏）

- 顶栏搜索（文件名即时过滤；内容搜索见 §8）
- **收藏夹**（D1）：两类混排，类型图标区分
  - 文件项：`名称 · host/项目 · 大小`；点击→预览；长按→取消收藏/分享/复制路径
  - **快捷指令项**（⚡）：`{id,name,hostId,workspaceId?,providerModel?,prompt}`；点击→（缺 workspace 则弹选择器）→ `agents.create(prompt)` → push 进新会话；长按→编辑/删除/立即运行
  - 创建入口：收藏夹 ＋；对话 composer 溢出菜单「存为快捷指令」（P1，随 C7）
- 主机分组头：连接点 + 名称 + ⚙（官方 host settings）；项目行：workspace 名 + 活跃 agent 数角标；「＋新建项目」；「＋连接新主机」
- 文件浏览屏：嵌官方 `FileExplorerPane`（面包屑/git 徽标保留），**打开行为覆盖为 Stack push**（C6 首要验证项；失败降级自绘轻量树，+2-3 天已计价）
- 文件动作：点击→预览（图片缩放/视频原生/代码高亮只读/md 渲染/html webview/二进制→信息卡+下载分享大按钮，走官方 download-store）；长按→收藏·下载·分享·复制路径·**添加到对话**

## 6. 我的 tab

- 概览卡：`N 主机 · M 项目 · K 活跃 agent`
- 官方设置页整页复用（push 官方路由）
- 壳设置：壳模式开关 · 主题(跟随/亮/暗) · 默认启动 tab · 清除本地数据 · 关于(壳版本+上游 commit)

**本地数据威胁模型记录（审查轮裁定：不加密，理由存档）**：壳态（`paseoGo.*`：settings/pins/archive/favorites/commands/readState）只含 serverId/agentId/路径/别名/水位等索引与偏好，无凭据；官方侧 host registry 同用 AsyncStorage（`host-runtime.ts:1407`），host 连接密码随官方路径明文落盘——改造属 `packages/**` 冻结范围（§2 铁律），壳不越权。裁定不加密的理由：① 本机可读 app 数据的攻击者同样能读到 Keystore 解封结果，静态加密只挡住"只拷走备份文件"这一半场景；② 场景定位是局域网/自托管私有部署，设备失守的主防线是系统锁屏与全盘加密；③ 用户侧已有控制权：本节"清除本地数据"一键复位 + daemon 侧密码可轮换。接受的残余风险：Android Auto Backup 可能把明文态（含官方 host 密码）带入云备份——介意者关闭系统云备份；上游如引入加密存储，壳直接受益，无需改动。

## 7. 对话详情（D2 直挂）

- 官方 agent 路由原样；返回→列表；进入即清未读
- 壳注入顶栏溢出菜单（若官方路由顶栏可传 props 则注入，否则 P1 自建薄顶栏）：查看项目文件 / 停止 / 重命名

## 8. P1 增强（全部要做，D4）

| 功能         | 方案                                                                                                               | 卡                |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 置顶拖拽排序 | react-native-draggable-flatlist（官方已依赖+patch）                                                                | C3                |
| 搜索         | 会话标题/内容(客户端过滤) + 文件名(explorer RPC)；**内容全文搜索**：spike 上游 #4659 的 RPC，无则立 known_issue 卡 | C9                |
| 会话导入     | ＋菜单 → 官方 omp 导入流程（daemon `listOmpImportableSessions`）                                                   | C10               |
| 推送通知     | spike 官方 expo-notifications 基建；目标=等待批准时后台可达；不可达则前台本地通知+known_issue                      | C11               |
| 添加到对话   | 文件长按菜单 → composer 附件                                                                                       | C6 尾/known_issue |

## 9. 视觉一致性

官方 Unistyles token；列表行高/圆角/间距对齐官方 sessions 列表；触觉反馈（长按/置顶/收藏成功）；暗色全走 token 自动适配；图标用官方 icon 集 + `@expo/vector-icons` 补缺。

## 10. 开工前置验证（C1 spike，四项，半天）

| #   | 假设                                            | 验证法             | 失败预案                       |
| --- | ----------------------------------------------- | ------------------ | ------------------------------ |
| A1  | host-runtime 多主机状态可在 (shell) 屏订阅      | 壳屏渲染 host 列表 | 直接用 @getpaseo/client 多实例 |
| A2  | 官方 agent 路由从 (shell) push 可正常 bootstrap | 真机点进会话       | 壳内嵌 view+自挂 Boundary      |
| A3  | FileExplorerPane 打开回调可覆盖为 Stack push    | 临时壳屏挂载试验   | 自绘轻量树 +2-3 天             |
| A4  | agent status 字段足以渲染四态状态灯             | 打印真实 payload   | 降级两态                       |

## 11. 证据契约（每卡固定四项）

1. 静态门禁：`pnpm typecheck` + `pnpm lint`（仓根）零错误
2. 套件：`pnpm test`（app 包相关全量）全绿
3. 真实运行：Paseo Go dev build 在 Android 真机/模拟器上触发变更路径
4. 读图：Agent 亲自 read 截图写结论（截图存 `paseo-go/evidence/<卡号>/`）

- 恰好一次 commit；报告 JSON：commit/per_item/verification/grep/known_issues

## 12. 卡序

C0 构建链 → C1 缝隙+骨架+spike → C2 对话列表 → C3 对话交互 → C4 对话接线 → C5 工作区树 → C6 文件+预览+收藏 → C7 快捷指令 → C8 我的 → C9 搜索 → C10 导入 → C11 通知 → C12 打磨 → C13 发布构建 → review 轮 → 总验收
