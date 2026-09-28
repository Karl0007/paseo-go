# KI-4 导入屏：父子会话关系仍无法辨认（v0.2.0 用户报告 2026-09-29）

## 现象（用户真机截图，竖屏）

导入会话屏（LAPTOP-K7UNLBKK / Oh My Pi 会话）：ReworkR45、IntakeF9、AnimF13、ReviewAB、WireF6、
IntakeF8、WireF5 一批**子代理会话完全平铺**，无父链副标题、无「可能活跃」徽标。
用户口径：「**还是**没有区分导入对话的父子关系」。

## 取证（2026-09-29 直连 devd@6767 发 `fetch_recent_provider_sessions`，limit=60）

- 线格式**字段是在的**：60 条中 50 条带 `parentHandleId`，3 条 `looksActive=true`；
  壳侧渲染链（`rows.ts:55-63` → `import.tsx` ImportRowCell）代码完整。
- **真缺陷 A：父会话自身没有可读名。** 实测父条目：
  `{ title: null, firstPromptPreview: null, lastPromptPreview: "现在新版流程里面提交是谁控制的？…" }`
  → daemon 按设计省略 `parentTitle`（`session-descriptor.ts:306-310` 只在父 title 存在时给）
  → 壳退回 `parentHandleId` 尾段 = `2026-09-27T03-56-25-600Z_01a0e101-c880-775f-939c-838083d6426b`。
  **即使最新 daemon + 最新 APK，副标题也是一串时间戳+UUID，等于没区分。**
- **真缺陷 B：C25 只加了副标题，没有分组。** 用户要的是"一眼看出哪些是同一父会话的子代理"，
  平铺列表 + 每行一串 UUID 不满足。实测本例 50 条子会话只归属 **2 个父**（父都在列表内），
  分组价值明确。
- **待钉死 C：用户当时看的界面为何连副标题都没有。** 候选：
  ① 手机上的 APK 早于 C25（v0.1.0 发布包在批次二之前）；
  ② 手机连的是本机**官方安装的旧 daemon**（无 C25 字段，optional 纪律=不渲染），
  而非本 checkout 的 devd@6767。
  → 复现时先问/查 app 连的 daemon 与 APK 版本，再判是否还有第四因。

## 修复方向（待用户拍板，勿自行动手）

1. **可读父名**（缺陷 A，daemon 侧小改）：父 title 缺席时回退父 `lastPromptPreview` 首 24~30 字
   （已有字段，纯投影层，不动协议形状）；`parentHandleId` 仍保留作分组键。
2. **分组呈现**（缺陷 B，壳侧）：列表按父聚合成节（父行 + 缩进子行，父不在列表时用父名做节标题），
   或至少同父连续排列 + 组分隔线。属 DESIGN §14.10 的呈现层扩展，需用户确认口径后再动。
3. 版本可见性（缺陷 C）：导入屏对"旧 daemon 无父链字段"给一次性说明条，把静默缺席变显式告知。

## 影响面

导入选择体验：子代理会话与父会话混排难辨认，易误批量导入；无数据风险。
