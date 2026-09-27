# C31 平板双栏接线：三 tab body 抽取 + 右栏落位 + 选中态

## 背景 / 用户拍板

C30 骨架上的接线卡，机制=DESIGN-tablet.md §3.2/§7-C31。body 抽取复用 C16 files-screen-body 先例（git log d1b9596d）。

## 设计裁定（照 DESIGN-tablet.md 执行，不得重开）

1. **body 抽取 ×3**：chats/workspace/me 三屏把列表主体抽成 `src/shell/components/*-screen-body.tsx`（或 tablet 目录下包装，取改动最小），路由屏=薄壳（竖屏渲染 body 原样；宽屏时 body 渲染进 SplitHost 列表栏——机制按 §3.2：Tabs 仍在根 Stack，宽屏 tabBar 隐藏，(shell) 屏在右栏渲染为占位/null、body 经 SplitHost 消费，具体挂载姿势按 C30 落地结构定，**不得伪造 PaneContext**）。
2. **行点击→右栏**：会话行=现有 `shellNavigateToAgent`（零改动）；L2 工作区行=`shellFilesHref`；官方设置=既有 push——全部天然落右栏。
3. **选中态**=路由派生单一真相（当前 pathname/栈顶解析，纯函数+单测）：列表行高亮、轨项高亮。
4. **深链/冷启动**：`paseogo://` 冷启动带会话目标 → 右栏落会话、左栏回对话 tab；无目标 → 右栏空态占位屏（§4-9）。
5. **轨交互**：切 tab 保列表滚动位（body 不重挂为佳，做不到如实报告）；重复点=回顶（C30 桩接通）。
6. 未读/双拍、C18 完结制语义在宽屏路径上零变化（回归项）。

## 范围

- 动：`src/app/(shell)/{chats,workspace,me}.tsx`（薄壳化）、`src/shell/components/`（body 组件）、`src/shell/tablet/**`（接线+选中态纯函数+test）、locales（如需）
- 不动：官方文件；C21 胶囊/边缘带（C32）；C30 已定骨架结构（如需微调须报告说明理由）

## 工程约束

- **必须在 C17、C26 之后执行**（同文件 chats.tsx/workspace.tsx 基线）。
- BUILD.md #7/#8 纪律；定向套件口径同 C17。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：选中态纯函数矩阵（tab×pathname×无选中）+ 既有 chats/workspace 测试无新增失败。
3. 真机横屏：①点会话→右栏出官方会话+左列行高亮；②返回键→右栏回占位/上一个，列表不丢；③点 L2→右栏文件页；④深链冷启动落右栏；⑤轨切三 tab 正常、重复点回顶；⑥竖屏全功能零回退抽验（对话/工作区/我的各一屏对照）。
4. 读图 ≥8 存 `paseo-go/evidence/C31/`。

- 恰好一次 commit；报告 JSON。

## 验证记录

### 代码阶段（上一轮已落，本轮复跑）

- body 抽取 ×3 + 薄壳 ×3 + `section-focus` 总线 + `tablet-selection` 纯函数 + `detail-placeholder` + `list-column` 双实例 + locales 三键（`tablet.detailPlaceholder.{chats,workspace,me}`，`listPlaceholder` 退役）。
- 本轮（overlay 修复后）定向复跑：`npx vitest run src/shell/tablet src/shell/section-focus.test.ts src/shell/locales.test.ts` → **7 文件 76 例全绿**。

### 设备阶段（AHPEBB1826005071；metro@8081 + devd@6767 未动）

- 冷启拉新 bundle：force-stop → `am start` → 点 `http://localhost:8081` 行；`node_modules/expo-router/entry.bundle?platform=android&…&transform.routerRoot=src%2Fapp` → **HTTP 200**（metro `Bundled 25714ms (6158 modules)`）。
- 横屏几何（uiautomator bounds，1600x2560@400dpi → 竖 640dp / 横 1024dp）：轨 `[0,0][160,1600]`=64dp、列表栏 `[160,0][910,1600]`=300dp、右栏 `[910,0][2560,1600]`=660dp（§2 lg 表），底部 tabBar 隐藏。
- **①** `11`/`17`/`23`：点会话 → 右栏官方会话真路由（C21 头 + 时间线 + composer），左列该行灰底高亮、行内 dot/⋯ 抑制。
- **②** `12`/`18`：硬件返回 → 右栏回 `shell-tablet-detail-placeholder`（文案随 section），左列 8 行 bounds 逐一不变（列表不丢）。
- **③** `14`：工作区 L1 展开 → 点 L2 worktree 行体 → 右栏文件页（`files-pane-header` + C27 三段页签 文件|diff|git 记录 + 文件列表），左列树保持展开。
- **④** `22`/`23`：`am start -a VIEW -d 'paseogo://h/srv_qwLjUbVgXsbm/workspace/wks_a712467a0d3773bd?open=agent%3Ae57bdfbe-…'` 冷启动 → 直落会话（首帧「正在连接」，host 上线后出时间线），左栏=对话 tab（轨绿）+ 该行高亮；系统弹「Paseo Go / Paseo Go Debug」选择器（release 与 debug 同注册 `paseogo`），选 Debug + **仅此一次**（未改系统默认处理程序）。
- **⑤** `10`/`13`/`15` 轨切三 section：左列换 body、右栏占位图标+文案随 section（三键各验一次）；`20` 切走再切回**滚动位保持**；`21` 重复点当前项**回顶**（置顶组 C13 running 回到首行）。
- **⑥** `30`/`31`/`32` 竖屏（冷启动，`shell-tablet-split`=0、底部 tab bar 在）：对话（与交接基线 `00` 同构，仅数据多一行）/ 工作区（搜索 + 收藏 + 双 host 树 + 底栏）/ 我的（概览 / 官方设置 / 壳设置 / 关于 0.1.0 @ db4fd334）零回退。
- **C18 宽屏回归抽验** `16`→`17`→`18`：dev daemon 起 codex agent「C31 wide unread」（用完 `delete`，deletedCount=1）→ 完结后宽屏左列该行 **加粗 + 绿点**（`shell-chat-unread-…` bounds `[605,1139][625,1159]`）→ 点开（第一拍）全列表 dot=0 + 行高亮 → 返回（section-focus 第二拍）无残留未读；`19` 另见 needs_input 计数 pill / 红灯与未读点并存，符合 C18 裁定。

### 卡内修正（裁定 5「切 tab 保列表滚动位」）

- 现象：`display:"none"` 的 pane 在切 section 后 FlatList 滚动位归零（`24`=修复前实拍：滚到 C11 组后切工作区再切回，首行回到 C31 wide unread）；而同一列表 push→返回往返滚动位保持（`19`→点开→返回仍停在 C11 组）——把原因隔离到「隐藏」这一步，不是数据重取。body 确未重挂（工作区 L1 展开态跨多次切换存活）。
- 修法：`list-column` 的 pane 改 **绝对定位叠层 + `opacity` 遮挡 + `pointerEvents:"none"`**（不再 GONE）；单文件改动、三 body 零改动。复验：`20` 滚动位保持、`21` 重复点回顶仍生效、行点击落位正常（`23` 高亮行）。

### 未修发现（P1，属 C30 骨架域：转屏不激活分栏）

- 当前树复现 2 次：**JS 上下文创建时为竖屏**，随后把显示转到横屏不会激活分栏——Fabric 原生把布局重排到 1024dp 宽（uiautomator 根 `[0,0][2560,1600]`、`dumpsys` activity `w1024dp land`），但 Unistyles `rt.breakpoint` 仍是 `sm` → `useIsCompactFormFactor()` 恒 true → compact UI 被横向拉伸。反向（横→竖）能翻回：临时探针 `LOG [C31-debug] … compact=true win={"width":640,"height":1024}`；再转回横屏后无新日志（= 无重渲染）。**冷启动在横屏一切正常**（`compact=false win=1024x640`，本卡全部横屏证据即此姿势）。
- 探针已删（`use-tablet-split.ts` 与 HEAD 零差异）。
- 本卡不动它的理由：根因在 Unistyles 断点不随转屏更新（官方 `useIsCompactFormFactor` 面），且轨宽/列表宽走同一断点表——只换激活信号会得到「分栏已开但宽度是旧断点」的半更新态；竖屏零回退验收不受影响（横/竖各自冷启动均正确）。候选修法留下一卡：激活与尺寸同源于 `useWindowDimensions()`，或转屏后强制 reload JS。

### 证据与复位

- 读图 19 张（≥8）：`00`、`10`-`24`、`30`-`32`（逐张亲自 read）。
- 设备复位：`user_rotation=0`（竖屏）、主题=跟随、壳模式=ON、输入法=百度（全程未换 IME，无需 ADBKeyboard）、metro/devd 未动；测试 agent 已删。
