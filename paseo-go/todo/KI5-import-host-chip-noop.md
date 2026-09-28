# KI-5 导入屏：顶栏主机 chip 点击无反应，无法切换/添加主机（v0.2.0 用户报告 2026-09-29）

## 现象（用户真机截图）

导入会话屏顶栏第二行显示「LAPTOP-K7UNLBKK ⌄」（带下拉箭头，视觉上是可展开的选择器）。
点击后**无任何反应**——不弹主机列表、无「添加主机」入口。用户口径：「上方点击，无法选择主机」。

## 根因（静态已钉死，`hosts/host-chooser.tsx:88-91`）

`useHostChooser()` 返回的 `chooseHost` 有三条分支：

```
availableHosts.length === 0 → onNoHosts ?? 跳「添加主机」路由，return false
availableHosts.length === 1 → 直接 void onChooseHost(那一个)，return true   ← 命中
availableHosts.length >= 2  → open(...) 弹 HostChooserModal
```

用户当前只有 **1 台主机**（「我的」页概览卡实测「1 主机 · 6 项目」）→ 走第二条分支：
静默把 serverId 设成**已经选中的同一台**，modal 从不打开。
导入屏 chip（`import.tsx:443-456`）无条件渲染 `ChevronDown` 且 `handleHostChip` 不做单主机判断
→ **箭头承诺了一个不存在的选择器**。
且单主机态下 `onNoHosts` 永不触发，本屏再无任何路径进入「添加主机」。

> 官方桌面 sheet 用同一 hook，同样静默；但官方 IA 里主机管理在设置页有常驻入口，
> 壳的导入屏是隐藏 tab、返回即回对话列表，**这屏就是用户想找主机的地方**，缺口感更硬。

## 修复方向（待用户拍板，勿自行动手）

1. **单主机也弹选择器**（壳侧，最小）：`handleHostChip` 不走 `chooseHost` 的自动选中捷径，
   改为壳自己的列表（含当前主机 + 「添加主机」行），语义与箭头一致。
2. 或**按状态收掉箭头**（更保守）：`hosts.length <= 1` 时不渲染 `ChevronDown`，
   chip 退化为纯标签 + 长按/次级入口进主机管理——诚实但少了入口。
3. 无论哪条：单主机态需要保留「添加主机」可达路径（现完全不可达）。

口径确认点：用户是想**切到另一台已配对主机**，还是想**添加新主机**？两者都要有入口。

## 影响面

只有一台主机的用户（=当前全部真机场景）在导入屏无法换/加主机；
多主机时该 chip 正常（modal 走根 `_layout.tsx:610` 的 `HostChooserModal`，非被覆盖屏，无 C14 那类不挂载问题）。

---

## 用户裁定（2026-09-29 拍板，验收只认本节）

**点击顶栏主机 chip → 统一弹主机列表（不再单主机静默自动选中），列表末尾恒有「添加主机」项。**

## 实现口径（纯壳侧；文件域 = import.tsx / locales，与 KI-4 相交 → **排在 KI-4 之后串行**）

1. **新组件** `src/shell/components/host-picker-sheet.tsx`：复用官方菜单引擎 sheet 形态
   （`@/components/ui/dropdown-menu` `compactMode="sheet"`，照 `command-workspace-picker.tsx`
   的受控 open + 隐藏 trigger 姿势，勿自造 Modal）。
   - props：`{ open, hosts, currentServerId, onPick(serverId), onAddHost(), onClose() }`；
   - 行序：`orderHostsLocalFirst`（官方，从 `@/types/host-connection` 导入）；
   - 每主机行：leading=`HostStatusDotSlot(serverId)`（官方 host-picker 已有件），
     label=host.label，description=host.serverId，`selected = serverId===currentServerId`；
   - **恒有末行**「添加主机」（Plus 图标）→ `onAddHost`。
2. **`src/app/(shell)/import.tsx` 接线替换**：
   - 删 `useHostChooser` 及其 import、`openHostChooser`/`handleHostChip` 的捷径分支；
   - chip `onPress` → 恒 `setHostSheetOpen(true)`；
   - 挂载自动选（`serverId===null && hosts.length===1`）保留——**入口免弹，点击必弹**，两事分开；
   - `onAddHost` → `router.push(buildSettingsAddHostRoute(Date.now()))`
     （从 `@/utils/host-routes` 导入，官方既有路由，与 host-chooser 零主机分支同路径）；
   - `hosts.length===0` 时 chip 仍直跳 welcome（既有行为不动）。
3. **locales**（`src/shell/locales/{en,zh}.json`）：新增 `import.addHost`；sheet 标题复用 `import.chooseHost`。

## 验收（证据契约四项）

1. app typecheck + oxlint 零错误。
2. 定向：sheet 组件渲染用例（行序 local-first、当前主机 selected、恒有添加主机行）；
   app 套件失败集 = W1 基线零新增。
3. 真机（MatePad）：**单主机态**点 chip → 弹出列表含该主机（选中态）+「添加主机」行；
   选中切换列表数据源；「添加主机」落官方加机流程；挂载免弹直入回归。
4. 读图 ≥3 存 `paseo-go/evidence/KI5/`。

恰好一次 commit；报告 JSON（commit/四项证据/测试尾部/known_issues）。
