# KI-14 会话屏隐藏官方顶栏 chrome（header 带 + tab 行）——上游触点（用户拍板 2026-09-29）

## 用户裁定

问：「能不能把上游原有的隐藏呢？」→ 拍板 **批：隐藏（3-4 行触点）**。
目标：会话屏顶部带真塌矮（达成 KI-8「变矮」诉求的物理前提）+ 官方 tab 行的「关 tab→归档」原生不可达（比 Portal 盖条彻底）。

## 关键事实（ChromeHideScout 已取证，带行号）

- 两条官方 chrome **不是** react-navigation header（`h/[serverId]/_layout.tsx:10-13`、`(shell)/_layout.tsx` 早已 `headerShown:false`）。是 `packages/app/src/screens/workspace/workspace-screen.tsx`（4421 行）内**在流 JSX**：
  - header 带 = `ScreenHeader`，挂载 `:4040`（门 `showScreenHeader :3827`，`shouldShowWorkspaceScreenHeader = !isFocusModeEnabled || isMobile` `:1378-1383`，compact 下恒真）。
  - tab 行 = `MobileWorkspaceTabSwitcher`（`testID=workspace-tabs-row`），挂载 `:4042`（门纯 `isMobile`）。
  - gate 态第二条 header = `WorkspaceScreenGateFrame` `:1293-1300`/`:1343`/`:3753`（只门 :4040 会在 hydration 闪 88dp 带）。
- 零触点路径全排除：`isMobile=useIsCompactFormFactor()=width<720`（`constants/layout.ts:59`，无 override）；`focusMode`（panel-store `:131/:148`）compact 下被 `||isMobile` 旁路且桌面副作用大——错的开关。
- 现成壳侧读取源：`usePaseoGoShellActive()`（`src/shell/stores/settings.ts:53-56`）。

## 实现口径

### 上游触点（1 文件，3~4 行，门在 shellMode 非宽度 → 官方模式/e2e 零变化）

`packages/app/src/screens/workspace/workspace-screen.tsx`：

1. 读取源（:1548 附近）：`const hideOfficialSessionChrome = usePaseoGoShellActive() && isMobile;`（+ import）。
2. `:4040` header 带：`{rendersDesktopSplitContent || hideOfficialSessionChrome ? null : renderWorkspaceScreenHeader()}`。
3. `:4042` tab 行：`{isMobile && !hideOfficialSessionChrome ? <MobileWorkspaceTabSwitcher …/> : null}`。
4. `:1296` gate 态 ScreenHeader：同门（防 hydration 闪带）。

**COMPAT 注释**（照 `constants/layout.ts:44` 先例）标注触点理由 + 解缝口径（merge 冲突=重新贴缝，保留上游正文重贴本条件）。DESIGN §2.1 缝隙扩容记入 §16。

### 壳侧退役 + 承接

- **删** `src/shell/session-header/tab-row-cover.ts` + `tab-row-cover.test.ts`（盖条机制在行卸载后转死代码，测试断言 `workspace-tabs-row` 存在必挂）。
- **改** `src/shell/components/shell-session-header.tsx`：移除 KI-8 引入的 `tabRowCover`/cover 补偿常量（带塌后无需钉底边）；胶囊高度回归纯内容高。
- **承接消失的 header 功能**（隐藏后官方 header 带里的入口消失，逐个核）：
  - SidebarMenuToggle（抽屉）/标题/分支/host badge/⋯ 菜单/WorkspaceActions → **壳胶囊已全替代**，无需动作。
  - `WorkspaceHeaderExplorerToggle`（:3785 开官方 explorer overlay）→ 壳有自有文件屏（胶囊 ⋯「查看项目文件」→ DETAIL.files，KI-9 已接），**官方 overlay 入口在壳内不需要**；确认无他处依赖壳态该按钮。
  - `PluginHeaderButtons`（:3761）→ **待核**：查有哪些插件在 compact 顶栏渲染按钮、壳是否需承接；无活跃消费者则记 known_issue，有则胶囊 ⋯ 加槽。

## 验收（证据契约四项）

1. app/protocol typecheck + oxlint 零错；`build:server` 不受影响（纯 app 触点）。
2. 既有 workspace-screen / session-header / visibility 测试零新增失败；`tab-row-cover.test.ts` 随文件删除；app 套件失败集=W1 零新增。
3. 真机（MatePad）：壳态会话屏顶部带**塌到胶囊内容高**（与隐藏前同屏对比帧可见明显变矮）；官方 tab 行不可见不可点（关 tab→归档彻底不可达）；内容区上移无空白；hydration/loading/error 态不闪官方带；宽屏（非 compact）不受影响（门在 isMobile）；官方模式（关壳 flag）行为逐帧不变。
4. 读图 ≥4 存 `paseo-go/evidence/KI14/`（含隐藏前后对比 + 官方模式回归帧）。

## 依赖与纪律

- 排 **KI-8 之后**（同碰 shell-session-header.tsx 高度；KI-8 的 cover 补偿本卡删除）。
- 恰好一次 commit（`feat(paseo-go): KI-14 …`）；触点申报进 ACCEPTANCE §1a + DESIGN §16。
- 报告 JSON：{commit, gates, touchpoint:{file,lines,diff}, retired:[tab-row-cover…], plugin_header_finding, deferred, known_issues}。
