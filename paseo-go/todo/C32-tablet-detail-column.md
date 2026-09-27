# C32 平板详情列收尾：胶囊右栏几何 + 边缘带 compact-only + 宽屏实测矩阵

## 背景 / 用户拍板

DESIGN-tablet.md §7-C32。C21 胶囊在分栏后的几何收尾 + 宽屏行为实测钉死。**依赖 C21、C27、C30、C31 全部落地。**

## 设计裁定（照 DESIGN-tablet.md 执行，不得重开）

1. **胶囊几何**：root floating host 在 AppContainer 内 → 分栏后天然=右栏顶（§3.2 论证）；实测钉死并截图（亮/暗）。若实测发现覆盖官方 header 的几何在右栏内错位（右栏内官方 header 本就在右栏顶，预期正确），修正=样式级，禁动 visibility 纯谓词语义。
2. **visibility 谓词扩 isCompact**（§3.2）：C21 左缘返回带 **compact-only**（宽屏右栏内不做边缘返回带——右栏 pop 由硬件返回/胶囊返回键承担）；`session-header/visibility.ts` 输入加 isCompact，纯函数+单测矩阵扩全。
3. **宽屏实测矩阵**（§4/§6 逐项钉）：文件三段页签（C27）在右栏、预览 push 落右栏、键盘避让 composer 实测（§4-4，全局无 KAV 的结构性成立要真机证据）、settings 在 660dp 右栏自动单列降级（官方逻辑抽验）、md 窄型（720-991dp 窗口/分屏）列表塌缩阈值行为。
4. R-4（AppContainer viewportWidth 取窗口宽）：确认影响面≈0 的实测证据（左栏浮层如有相对测量错位→按 §R-3 官方具名宿主一行加挂，报告注明）。

## 增补裁定（C31 移交，必做，P1）

5. **C31-F1 运行中竖→横转屏不激活分栏**（C31 真机复现 2 次实锤）：JS 上下文竖屏创建后转横屏，Fabric 原生重排到 1024dp（uiautomator 根 `[0,0][2560,1600]`、dumpsys w1024dp land）但无 `shell-tablet-*` 节点；横→竖能翻回 compact，再转回横无重渲染；横屏冷启动正常。
   - 机制嫌疑 `[INFERENCE]`：Unistyles `rt.breakpoint` 不随转屏更新（官方 `useIsCompactFormFactor` 面），分栏激活与轨宽/列表宽同源该断点 → 只换激活信号会得到"分栏已开但宽度是旧断点"半更新态。
   - 修复方向（择一，须真机验证转屏双向即时生效）：分栏激活与三栏宽度**同源于 `useWindowDimensions()`**（不依赖 Unistyles 断点），或转屏后强制 reload JS（次选，体验差）。禁只改激活信号留半更新态。
   - 验收增项：真机运行中竖→横→竖→横连续转屏，分栏与右栏占位/轨宽逐次即时正确切换（截图序列），且横屏冷启动仍正常（不回归 C30/C31 已过项）。

## 范围

- 动：`src/shell/session-header/visibility.ts`（+test）、`src/shell/components/shell-session-header.tsx`（isCompact 分支样式级）、`src/shell/tablet/**`（如需 R-3 加挂）
- 不动：C21 已定的菜单矩阵内容、官方文件

## 工程约束

- BUILD.md #7/#8 纪律；定向套件口径同 C17。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：visibility 扩参矩阵（compact×wide × 可见性桶）。
3. 真机横屏：上列实测矩阵逐项（键盘弹出 composer 不被遮、预览返回、settings 单列、720dp 分屏塌缩）+ 竖屏 C21 边缘返回仍可用（回归）。
4. 读图 ≥8 存 `paseo-go/evidence/C32/`。

- 恰好一次 commit；报告 JSON。

## 验证记录（C32 落地，2026-09-27）

### 裁定 5 = C31-F1（P1，已修，机制比卡内嫌疑更深一层）

- **实锤机制**：转屏不激活分栏的直接原因确是激活信号源（Unistyles `rt.breakpoint` 不随运行中转屏更新），但把它换成窗口宽后暴露**第二层根因**：旧 split-host 在激活翻转时切换 children 槽位的元素类型（`!active ? children : <View>…`）→ 官方 AppContainer 整棵子树卸载重挂 → RNGH 2.28 在重挂竞态中确定性红屏 `Unable to find node on an unmounted component`（挂载 detector 的 layout-effect `attachHandlers→gestureWillMount` 级联到删除中 detector 的 mount-listener，`findNodeHandle` 打已删 host；passive cleanup 跑在后面）。真机竖→横带会话打开时 100% 复现（红屏实录见本报告）。
- **修复（两步，缺一不可）**：① 新增 `src/shell/tablet/form-factor.ts`：分栏激活 + 轨/列表宽 + 胶囊 compact 分支 + (shell) tabBar 隐藏分支**全部同源 `useWindowDimensions()`**（阈值 720/992 镜像断点表，`form-factor.test.ts` 钉死）；② split-host 改**稳定包装链**（children 恒在 row→detail 同一槽位，compact=两层透明 flex:1，宽屏翻转=纯样式切换，零重挂）。§2「转屏不触导航栈」由设计断言升级为结构保证。
- **真机验收**：运行中会话打开态连续 竖→横→竖→横（+前置一轮）逐次即时正确：竖=全屏 push+边缘带在+[0,0][1600,220] 全宽胶囊；横=三栏+轨 64dp+列 300dp+[910,0][2560,150] 右栏胶囊+边缘带节点消失。截图序列 02→03→04→05（首轮）与 17→18→19→20（复验轮）+ uiautomator 逐帧探针（split/band/header/rail bounds）。横屏冷启动不回归（06）。

### 裁定 1 胶囊几何

- 右栏顶覆盖官方 header，亮(03/08)/暗(07) 均无错位 → **零样式改动**（barStyle wide 分支 insets.top+36dp 与官方 header 等高，胶囊底边=官方 tab 行顶）。

### 裁定 2 visibility 扩 isCompact

- `ShellSessionVisibilityInput.isCompact`（必填）+ 新纯函数 `shouldEnableShellEdgeBack`（胶囊可见 ∧ compact 才开带）；胶囊判定对断点**逐桶不变**（wide 保留=详情头）。组件侧：带 View 与 Pan 同步 compact-only（wide 下 testID 消失=真机门证据，03/05/16/18/20 帧 band=0）；宽屏左缘右滑不再弹栈（16 帧会话保持）。单测：9 桶 × compact/wide 双跑 + 既有桶逐值不变锚（visibility.test.ts 全绿）。
- 竖屏 C21 边缘返回回归：滑带右滑→pop 回列表（15 帧）。

### 裁定 3 宽屏实测矩阵

- C27 三段页签右栏实渲（09：文件|diff|git 记录，头/搜索/树完整）；预览 push 落右栏（10：AGENTS.md，左列表不动）；键盘避让=结构性成立实锤（11/11b：ADBKeyboard 与系统输入法双路径，composer 完整浮于键盘上，轨/列 bounds 键盘前后逐像素不变 [160,0][910,1600]）；**settings 660dp 单列降级=设计前提证伪**：官方 settings 的分栏判定读 `useIsCompactFormFactor()`（窗口宽），不读容器宽 → 右栏内仍渲桌面分栏（sidebar 320dp+detail 340dp@lg / 244dp@md，12/14 帧），功能完整无裁切无溢出，但非单列——官方文件禁改，记 known_issue（R-4 同族：窗口宽乐观）；720–991 窄型实测（13：880dp 窗口=轨 56+列 260+详情 564，窗口宽经 `wm size` 实时改 560↔880 双向即时塌缩/激活，13a=560dp 塌缩回 compact tab 态）。

### 裁定 4 R-4 影响面

- 全部宽屏帧均=三列，无第四列、无 LeftSidebar 意外开栏路径（toggle 被胶囊覆盖不可达实锤）；`viewportWidth=窗口宽` 的乐观面唯一可见外溢=settings 内部分栏（上条），无溢出/崩溃。R-3 左栏浮层：＋菜单/行菜单=窗口级 Modal，跨列锚定正确（21 帧 popover 贴列边右展，无相对测量错位）→ 无需具名宿主加挂。

### 矩阵附带修复（宽屏列头溢出）

- 实测发现 300dp 列内 chats 头行溢出：搜索/＋被推出列右缘 165px 完全不可达（dump 实锤 [995,1075]>910）。样式级修（chats-header.tsx）：状态 pill `flexShrink:1` 吸收全部溢出（省略号→点），段组/图标 `flexShrink:0` 保持可读可达；compact 无溢出=逐像素不变（23 帧 bounds 与 01 基线逐值一致），宽屏修后 22 帧全控件列内。

### 证据与门禁

- 门禁：`npm run lint` 0/0；app `tsgo --noEmit` exit 0。定向：src/shell 全量 42 文件 420 测试绿（含新 form-factor.test.ts 13 例、split-host 新增「翻转零重挂」结构测试、visibility 扩参矩阵 18 例双跑）。真机读图 24 张 ≥8，存 `paseo-go/evidence/C32/`。
