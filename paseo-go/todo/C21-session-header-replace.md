# C21 会话屏顶栏替换 + 边缘手势改道 + ⋯ 聚合官方右侧动作

## 背景 / 用户拍板

用户：「希望下面那一串带返回带三个点的（壳胶囊）是顶部的区域，能够真正替换掉它原生的顶部逻辑。向左滑动（原本拉出左侧面板的手势，手指向右）改为返回对话列表。右侧三个点集成现有右侧区域逻辑：查看文件、查看 diff、运行 xxx 之类的。」这是对 C14"底部共存"分支的推翻。裁定 DESIGN §14.5。**依赖 C19（⋯ 用 popover）**。

## 设计裁定（照此执行，不得重开）

1. **胶囊上移**：`shell-session-header.tsx` 从底部浮层改为**顶部全宽**（Portal 机制不变=根 floating-panels host；改锚定+样式）：高=官方 compact header 高+状态栏 inset，背景 surface0 不透明+下边框 token，盖住官方 header（其控件不可达=预期）。可见性谓词（`session-header/visibility.ts`）**不动**。
2. **⋯ 菜单聚合**（复用官方动作层，不重实现；菜单矩阵扩展进 `visibility.ts` 纯函数半区+单测）：
   - 查看项目文件（既有 `shellFilesDetailHref`）
   - **查看 diff** / **查看文件** = 切官方工作区 tab（changes/files）——找官方打开 tab 的单一出处（keyboard action `workspace.tab.open` / panel-store action / `openExplorerSidebarView`），走同一条路
   - **运行脚本** 子页：数据源=workspace descriptor `scripts`；执行=官方 WorkspaceScriptsButton 背后的同一 client RPC（点名出处后复用）
   - 停止 / 重命名（既有 shellAgentActions）
   - 官方 ⋯ 其余项按"常用上提、其余舍弃"处理，取舍清单写进报告（汉堡抽屉不可达=预期决策，记录即可）
3. **边缘手势改道**（纯壳）：胶囊可见期间向 `mobile-panels` provider 注册 `setOpenGestureBlocked(symbol)`（卸载释放）——左缘开列表/右缘开 explorer 两手势同停；壳装**左缘透明 Pan 带**（宽≈32px，方向锁横向阈值，纵向穿透给滚动）→ `router.back()`。
4. **壳外零行为变化**：blocker 释放后官方 IA 边缘手势必须原样（真机验证项）。

## 范围

- 动：`src/shell/components/shell-session-header.tsx`、`src/shell/session-header/visibility.ts`（+test）、新增手势 hook（`src/shell/session-header/` 下）、必要时 `routes.ts`
- 不动：官方 workspace-screen/mobile-panels/gestures 本体（只消费其 API）；官方 header 代码

## 工程约束

- Portal/Modal Android 坑先读 docs/floating-panels.md；C14 已证 Modal 覆盖屏不挂载、Portal 可行。
- 定向套件口径同 C17；全量对照批尾执行。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：visibility/菜单矩阵单测扩展全 bucket×stoppable；手势方向锁纯函数单测。
3. 真机矩阵：①胶囊顶位覆盖官方 header（暗色+亮色）；②左滑→回对话列表；③⋯ 内查看 diff/查看文件/运行脚本实跑各一次；④停止/重命名不回退；⑤官方 IA（壳关）左右缘手势原样；⑥返回键/系统返回并存正常。
4. 读图 ≥6 存 `paseo-go/evidence/C21/`。

- 恰好一次 commit；报告 JSON（含取舍清单）。

## 验证记录

- **代码/定向**：`visibility.ts` 扩 `explorerOverlayOpen` 门（可选输入，既有桶逐值不变）+ 菜单矩阵 6 行×4 输入（2^16 全桶钉死）+ runner 扩 diff/explorer 分发；新增 `edge-swipe.ts`（方向锁纯函数，含 `"worklet"`——真机抓到缺指令时 UI 线程 `non-worklet function` 崩溃后补上）、`use-shell-edge-back-gesture.ts`、`scripts-submenu.tsx`（startWorkspaceScript/killTerminal = 官方 WorkspaceScriptsButton 同一对 RPC）。定向绿：session-header 3 文件 21 例 + locales/routes 13 例；app tsgo / oxlint / oxfmt 全绿。
- **胶囊上移**：Portal 机制不变，顶位全宽，高=insets.top+8+56（真机 uiautomator 实锤 `[0,0][1600,220]`=88dp×2.5），surface0+下边框；官方 header 被盖（汉堡/⋯/scripts/explorer 控件不可达=预期）。亮 `01`、暗 `12` 双主题截图。
- **⋯ 聚合**：`02` 六行矩阵（停止置灰=done 桶正确）；`03` 查看 diff→compact explorer「变更」页（真 diff +718/-96）；`04` 查看文件→「文件」页；`05-07` 运行脚本子页（popover 飞页）实跑 typecheck 起→运行中→停→未运行；`08` 重命名屏（C33 不回退）；`11` 查看项目文件（C16 栈实例）。**explorer 让位**：overlay 打开期间胶囊隐藏（其自有 rail 恰好落在被盖带内），`03/04` 可见 explorer 顶栏完整。
- **边缘手势**：blocker 用官方 `useBlockMobilePanelOpenGestures`（symbol-keyed，卸载即释放）。壳左缘滑动→回对话列表：`09`（3 次实滑均回列表）。**坑修正**：32dp Pan 带不能是独立 View（GestureDetector 的 view 在 Android 可触，实测吞掉该列点击——composer 左缘点不中）；改挂 box-none layer + 起点 x≤32dp 门，`10` 复测 composer 左缘 x=76px 点击键盘弹出=点击穿透。纵向穿透=同一命中测试路径（点击已证）+方向锁单测；测试会话均单屏高，未获得滚动位移正例（如实记录）。
- **壳外零变化**：壳关+官方会话屏，`13` 左缘 x=100px 右滑→官方抽屉打开（新建工作区可见）=blocker 已释放；官方 header 完整（`13` 背景）。右缘手势一次注入未开 explorer（共享 `openGesturesBlocked` 释放已由左手势证明；explorer 本体经 ⋯ 实开两次）。⚠ 设备侧注：x=20px 起的滑动被 EMUI 系统边缘返回抢先（官方屏上表现为退 app，与壳无关；本卡滑动验收用 x=100px 起点区分）。
- **取舍清单（官方 ⋯ 其余项）**：舍弃=新建会话（C17 直达 /new 已有）/新建浏览器（仅 Electron）/复制工作区路径/复制分支名/导入会话（壳 C10 导入屏）/显示 setup/新建终端+profile 列表/编辑终端 profile（终端在官方 tabs 面，壳低频）；不聚合=PluginHeaderButtons（插件面）、OpenInEditor（桌面 only）。丑牌抽屉（汉堡）不可达=预期决策（DESIGN §14.5）。
- **设备复位**：壳模式 ON、主题浅色、auto-rotate+手势导航恢复、`15` 壳列表回归截图。
