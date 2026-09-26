# C30 平板分栏骨架（ShellTabletSplitHost + 导航轨 + 触点贴缝）

## 背景 / 用户拍板

Q10 平板横屏 IM 范式，设计定稿=`paseo-go/DESIGN-tablet.md`（C29 交付，编排者已按 §14.11 批准 T-A 案，DESIGN §14.13 在案）。用户预授权直接落地，事后审。

## 设计裁定（照 DESIGN-tablet.md 执行，不得重开）

- 机制=§3.2 T-A：`packages/app/src/app/_layout.tsx` AppShell（929-942）用 `ShellTabletSplitHost` 包 AppContainer。**触点预算：净增 ≤10 行**（预期 import 1 + 包装 2，其余为缩进）；单包装点零逻辑；merge 解缝=重新贴缝。
- 新代码全在 `src/shell/tablet/**`：激活谓词纯函数（壳模式 && !isCompact && !full-bleed→否则透传 children 原样返回）、`ShellTabletSplitHost`（左列=导航轨+列表栏占位，右栏=AppContainer）、导航轨（对话/工作区/我的 三项，图标复用 (shell)/\_layout 同源 lucide；重复点当前项=回顶事件先留桩）、宽屏 tabBar 隐藏（`(shell)/_layout.tsx` 条件 display:none，Tabs 骨架/隐藏屏/lastFocusedTab 语义不动）。
- 列表栏本卡=占位（渲染活动 tab 名+空态占位屏）；真实 body 接线=C31。尺寸常量按 §4 表（轨 56/64、列表 260/300、详情 min 400、内容 max 820）。
- React Compiler 纪律：谓词纯函数+单测，禁 void-version（R-1）。KI3 冷启动族：pending 门控姿势，冷启动横屏暗色截图为验收项（R-2）。

## 范围

- 动：`packages/app/src/app/_layout.tsx`（仅 AppShell 包装点）、`src/shell/tablet/**`（新）、`src/app/(shell)/_layout.tsx`（tabBar 隐藏条件）、locales（轨三项复用既有 tabs.\* key，零新 key 为佳）
- 不动：三 tab 屏本体（C31）、C21 胶囊（C32）、官方其它文件

## 工程约束

- 环境坑纪律：BUILD.md #7（提交=rm `packages/app/.expo/types/router.d.ts` 后立刻 pathspec 提交）、#8（一切 cwd 大写盘符）；定向套件口径同 C17；禁跑全量。
- 竖屏零回退=硬验收（§6 断言表逐条对图）。

## 验收（四项证据契约）

1. 门禁零错误（触点后全仓 typecheck 必查 `_layout.tsx` 无残留错误）。
2. 定向绿：激活谓词/透传逻辑单测（compact×shellMode×full-bleed 矩阵）。
3. 真机（横竖屏切换用 `adb shell cmd display set-orientation` 或自动旋转实测）：①横屏=轨+列表占位+右栏三列，竖屏截图与 HEAD 基线**逐屏零差异**；②转屏往返无导航栈丢失；③冷启动横屏暗色正常；④壳模式关=官方 IA 横屏零变化；⑤官方包（sh.paseo.debug）不受影响（同 bundle 逻辑上 seam=false 透传，抽验一屏）。
4. 读图 ≥6 存 `paseo-go/evidence/C30/`（含竖屏基线对照）。

- 恰好一次 commit；报告 JSON（触点 diff 原样贴出）。

## 验证记录

### 代码阶段（已完成）

- **新目录 `src/shell/tablet/`**：`split-predicates.ts`（激活 2×2×2 矩阵 + full-bleed + pathname→section 纯函数）、`metrics.ts`（§4 尺寸表）、`rail-events.ts`（§4-8 重复点回顶事件桩）、`use-tablet-split.ts`（seam×断点×pathname 订阅层，含 pending 门控 R-2）、`nav-rail.tsx`（三项复用 `tabs.*` key + `(shell)/_layout` 同源 lucide 图标）、`list-column.tsx`（活动 tab 名 + C12 空态占位）、`split-host.tsx`（透传=直返 children）。
- **定向绿**：`src/shell/tablet` 5 文件 47 例全绿；邻域回归 `routes` / `focused-tab` / `locales`(zh-en 双语完备) / `session-header.visibility` 24 例全绿。
- **门禁**：仓根 `npm run typecheck` 全绿；仓根 `npm run lint`（oxlint 4401 文件）0 warnings 0 errors；`expo lint` 触点文件零输出；`format:check` 通过。
- **触点净增行数**：`app/_layout.tsx` 净 +3（import 1 + 开/闭 2，内部仅重缩进）≤ 预算 10；`(shell)/_layout.tsx` 只挂 wide 条件分支。
- **bundle 可运行性**：metro 全量 `entry.bundle` 200 / 52.7MB，`shell-tablet-rail` 在包内（共享 metro 纪律：每次触碰运行时代码后复验）。
- 落地期两处口径纠偏（记入工程知识）：① `useUnistyles()` 被 `docs/unistyles.md` 明令禁用 → 断点尺寸改走 Unistyles **breakpoint-keyed style values**（`width: { md, lg }`，先例 `components/schedules/schedules-table.tsx:153`），主题色改走 style-holder 渲染期读取（schedule-row 惯式），轨项按 react-perf 自绑 press + `useMemo` 化 `accessibilityState`；② vitest 下 `vi.mock` 的 `importOriginal` 不经过 `resolve.alias`，unistyles 测试替身须整模块替换。
- **known_issue（承 R-4）**：`AppContainer` 的 `viewportWidth` 仍取窗口宽而非右栏宽（`app/_layout.tsx:470`），分栏下官方 sidebar `canShare` 判定偏乐观；native 默认关且 toggle 被胶囊覆盖，影响面≈0，留 C32 真机确认无意外开栏路径。

**设备阶段=被硬阻塞（未 commit，等编排者裁决）**：装机 APK 的 MainActivity 被 `app.config.js:108 orientation:"portrait"` 锁死竖屏——实测显示已转 `ROTATION_90 / w1024dp land`（`dumpsys window` overrideConfig），但 app 窗口 `mCurrentConfig=... port ROTATION_0, 1600x2560`（截图 `90-blocker-display-rotated-app-stays-portrait.png`）。**JS/metro 无法绕过，任何横屏矩阵（三列/转屏往返/冷启动横屏/壳关横屏）都需要改 orientation 配置 + prebuild/gradle 重打 debug APK**（native 面，超出本卡文件所有权与共享 metro 分时纪律，需编排者立项）。设备已复位：rotation=auto、debug app 前台、metro/devd 未动。

**阻塞已解除（DESIGN §14.14 批准，Main 重打包装机后本卡自证）**：`app.config.js` 触点行改 `orientation: isPaseoGo ? "default" : "portrait"`（壳解锁横屏，官方包保持 portrait；`npx expo config` 双变体实测 `default`/`portrait` 各就位）。新 debug APK（prebuild --clean，screenOrientation=unspecified、scheme 恢复 paseogo）装机后横屏矩阵全绿。

已落图（debug 包 `package="app.paseo.shell.debug"` 经 uiautomator 实锤）：`00-portrait-chats.png` / `01-portrait-workspace.png` / `02-portrait-me.png` = 竖屏三 tab 在 C30 代码下与既有形态一致（底部 tab bar 在、无轨无分栏，透传零变化的真机侧证）；`90-blocker-*.png` = 阻塞证据。

### 设备矩阵（横屏，新 APK，读图 8 张）

- `10/11-landscape-*-split.png`：横屏=导航轨(对话/工作区/我的，选中绿强调)+列表占位栏(活动 tab 名+C12 空态「列表内容将在此显示」)+右栏真路由三列；底部 tabBar 隐藏。轨点击切 section 生效。
- `12/13-landscape-session-*.png`：点会话行→会话真路由落右栏(轨+占位栏不动，左列不闪)，硬件返回→右栏回会话列表、两列原位(§4-3 返回语义)。
- `14/15-rotate-*.png`：转屏往返——横屏开→竖屏会话全屏 push(栈保留)→回横屏自动落回右栏；导航栈全程不丢。
- `16-coldstart-landscape-dark.png`：冷启动横屏暗色=三列直接激活、暗色一致无闪白(R-2/KI3 姿势成立)。
- `17-shell-off-landscape-official-ia.png`：壳模式关→SplitHost 透传(无轨无分栏无异常)，官方 IA 横屏零变化；再开=轨即时恢复。
- 调试期临时探针(`console.log("[C30-debug]")`)已在 commit 前移除，metro bundle 200 复验；设备复位 auto 旋转+浅色+壳 ON。
