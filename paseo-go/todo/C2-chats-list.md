# C2 对话 tab：跨主机会话聚合列表

## 背景 / 用户拍板
DESIGN.md §4。手机主场景=随时看所有 agent 在干嘛。基线 = C1 HEAD，复用其 routes/stores/spike 结论。

## 设计裁定（照此执行，不得重开）
- 数据：订阅所有已连接 host 的 agents（A1 选定通道）；行=agent 会话，跨 host 扁平
- 行结构：provider 图标｜标题（未读加粗+计数角标）｜副标题 `项目名 · 相对时间 · 最后动态一行`｜状态灯四态（🟢运行呼吸/🟠等待批准/⚪空闲/🔴出错，按 A4 结论字段映射）
- 分组：已置顶（按 pins store 顺序，拖拽归 C3）→ 需要处理（等待批准）→ 最近活跃；相对时间用官方既有格式化设施
- 顶栏：连接状态胶囊（点开=各 host 状态+单 host 重试）｜搜索 icon（占位，C9 填充）｜＋菜单（新建对话=push 官方 new 流程；导入=占位 C10）
- 未读：`readState` store（lastReadAt vs 最后事件时间）；进会话清（C4 接线，本卡先写 store）
- 下拉刷新、冷启动骨架屏、离线 host 置灰分组+重试、空态引导（文案双语进 locales）

## 范围
- 动：`src/app/(shell)/chats.tsx`、`src/shell/stores/{pins,archive,readState}.ts`、`src/shell/components/**`（列表行/状态灯/分组头）、locales
- 不动：官方任何屏/组件源文件（可 import）

## 工程约束
- FlatList + 稳定 keyExtractor；渲染期禁止全量排序（memo 化派生）
- 呼吸动画用官方动画设施或 Reanimated（已依赖），低功耗循环

## 验收（四项证据契约）
1. typecheck+lint 零错误
2. app 包测试全绿；store 纯逻辑（分组/排序/未读）vitest 单测（边界：空/离线/多 host/等待批准优先）
3. 真实运行：两台 host 各起若干 agent，列表分组正确、状态灯正确、点击 push 进会话
4. 读图：≥3 张（分组列表含运行/等待态、离线置灰、空态）
+ 恰好一次 commit；报告含排序/分组决策表