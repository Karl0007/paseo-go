# B8-IMPORT 导入屏版式对齐会话行 + 归档徽标优先（F23）

## 口径（用户拍板）

1. **版式对齐壳会话行**（以 B8-ROWPILL 落地后的 chat-list-row 终态为参照，非照抄实现）：项目 icon 色块（复用 `projects/import-project-icon.ts` 与会话行同款取字/配色算法）、标题（firstUserMsg 截断）+ 时间贴右缘、副标题=项目 · 末条摘要。checkbox/序号列保留（多选语义不动）。
2. **徽标优先级：已归档 > 已导入**。两者同时成立只显示「已归档」（点按跳归档段行为保留，import.tsx 约 527 行）；「可能活跃」标逻辑独立不动。先诊断 `badge.state` 推导处为何 imported 压过 archived（约 171 行选择器看着已优先，问题多半在 state 计算）。

## 文件域

- `packages/app/src/app/(detail)/import.tsx`、`packages/app/src/shell/import/rows.ts`（+tests）、必要时 `use-import-list.ts`。
- 非目标：claimedTotal/计数（B8-COUNT 域，排你后面）、服务端。

## 验收

- 组件/逻辑测：徽标优先级用例（archived+imported→只显示已归档）+ 版式关键断言。
- 真机帧：导入屏行版式（icon/时间右缘/徽标）与对话 tab 同屏对照帧；帧存 `paseo-go/evidence/B8-IMPORT/`。
- scoped：`npx vitest run src/shell/import src/app` 相关绿 + typecheck + oxlint。**恰好一次 commit**。
