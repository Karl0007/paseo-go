# C32 平板详情列收尾：胶囊右栏几何 + 边缘带 compact-only + 宽屏实测矩阵

## 背景 / 用户拍板

DESIGN-tablet.md §7-C32。C21 胶囊在分栏后的几何收尾 + 宽屏行为实测钉死。**依赖 C21、C27、C30、C31 全部落地。**

## 设计裁定（照 DESIGN-tablet.md 执行，不得重开）

1. **胶囊几何**：root floating host 在 AppContainer 内 → 分栏后天然=右栏顶（§3.2 论证）；实测钉死并截图（亮/暗）。若实测发现覆盖官方 header 的几何在右栏内错位（右栏内官方 header 本就在右栏顶，预期正确），修正=样式级，禁动 visibility 纯谓词语义。
2. **visibility 谓词扩 isCompact**（§3.2）：C21 左缘返回带 **compact-only**（宽屏右栏内不做边缘返回带——右栏 pop 由硬件返回/胶囊返回键承担）；`session-header/visibility.ts` 输入加 isCompact，纯函数+单测矩阵扩全。
3. **宽屏实测矩阵**（§4/§6 逐项钉）：文件三段页签（C27）在右栏、预览 push 落右栏、键盘避让 composer 实测（§4-4，全局无 KAV 的结构性成立要真机证据）、settings 在 660dp 右栏自动单列降级（官方逻辑抽验）、md 窄型（720-991dp 窗口/分屏）列表塌缩阈值行为。
4. R-4（AppContainer viewportWidth 取窗口宽）：确认影响面≈0 的实测证据（左栏浮层如有相对测量错位→按 §R-3 官方具名宿主一行加挂，报告注明）。

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
