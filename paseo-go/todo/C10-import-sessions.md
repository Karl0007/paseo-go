# C10 会话导入入口

## 背景 / 用户拍板
DESIGN.md §8；daemon 已有 omp 导入能力（provider `listOmpImportableSessions`）。基线 = C9 HEAD。

## 设计裁定（照此执行，不得重开）
- 对话 tab ＋菜单 →「导入会话」→ 壳内导入屏：选 host → 列可导入会话（标题/时间/项目）→ 勾选导入 → 成功后出现在对话列表并进入第一条
- 实现优先复用官方既有导入流程/组件（若官方有导入 UI 路由则 push；仅 API 无 UI 则壳内做薄列表屏调 SDK）
- 导入中进度反馈；重复导入幂等提示

## 范围
- 动：`src/app/(shell)/import.tsx`、＋菜单接线、locales
- 不动：官方源文件

## 验收（四项证据契约）
1. typecheck+lint 零错误
2. app 包测试全绿（导入项映射单测）
3. 真实运行：从真实 omp 历史导入 ≥2 条 → 列表出现 → 点开历史 timeline 完整
4. 读图：≥3 张（导入列表、勾选态、导入后 timeline）
+ 恰好一次 commit