# C19 壳菜单 sheet → 锚定 popover

## 背景 / 用户拍板

用户：「现在的加号、长按之类的逻辑都会在屏幕下方弹窗。但通常的软件设计是在你点击的区域旁边弹出一个小的弹窗。」取证：壳全部已骑官方菜单引擎（`components/ui/menu/`），只是显式选了 `compactMode="sheet"`；引擎 compact 默认即锚定 popover（锚定/翻转/钳制在 `menu-anchor.ts` 有单测；compact popover 行高按拇指 40pt 设计）。裁定 DESIGN §14.3。

## 设计裁定（照此执行，不得重开）

1. 逐菜单切 popover（去掉 `compactMode="sheet"` 或显式 `"popover"`）：
   - `src/shell/components/chats-header.tsx`：主机胶囊 DropdownMenu、＋菜单 DropdownMenu
   - `src/shell/components/chat-list-row.tsx`：ContextMenu（引擎默认 compact=sheet，需显式 popover）
   - `src/shell/components/file-action-menu.tsx`：ContextMenu + DropdownMenu 两形态
   - `src/shell/components/workspace-favorite-row.tsx` / `workspace-command-row.tsx`：长按 ContextMenu
   - `src/shell/components/shell-session-header.tsx`：⋯ DropdownMenu
   - `src/app/(shell)/workspace.tsx` / `me.tsx` / `import.tsx`：grep `compactMode` 与引擎 import 兜底扫尾
2. **保留 sheet**：含 `MenuTextField`/BottomSheetTextInput 的菜单页（引擎硬约束）；壳 rename 走独立屏，预计无此类——若遇到，保留 sheet 并在报告注明。
3. 宽度：`width={300}` 类 prop 在 popover 下由引擎边缘钳制接管，视觉不对再调，改动最小化。
4. **这是官方引擎在手机上的首个 popover 重度使用**：踩出引擎级缺陷（锚定错位/白闪/Android Portal 层问题）→ 允许对 `menu-anchor.ts`/`AnchoredSurface`/引擎文件做**最小正式修复**（上游风格、带单测、报告单列 diff 说明）；docs/menus.md + docs/floating-panels.md 先读。
5. 拖拽共存：chat-list-row 长按与 `useShellRowDragMenu` 的时序不动（C20 再改接力）；本卡只换呈现层。

## 范围

- 动：上列壳组件文件 + 各 test（如菜单矩阵测试的呈现断言）；（仅当缺陷实锤）官方菜单引擎文件
- 不动：菜单条目内容/动作语义（那是 C20/C21/C24 的事）

## 工程约束

- i18n/主题零缝隙不变；路由串不变。
- 定向套件口径同 C17；全量对照批尾编排者执行。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向套件无新增失败。
3. 真机逐屏矩阵（截图）：＋菜单/主机胶囊（顶栏锚定+右缘钳制）、行长按（触点锚定）、行 ⋯、收藏/指令长按、文件预览 ⋯、胶囊 ⋯；顶行菜单**翻转**到下方、右列**钳制**不出屏；暗色；长按选择动作正常；官方 IA（壳模式关）不受影响。
4. 读图 ≥6 存 `paseo-go/evidence/C19/`，每张写锚定位置结论。

- 恰好一次 commit；报告 JSON + 引擎修复清单（若有）。
