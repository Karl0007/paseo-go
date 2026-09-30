# RESEARCH: Provider 双写者语义调研（R2-full 前置）

> 状态：**待调研**（2026-09-30 用户裁定：所有权状态机先做 lite，full 单开本文档）。
> 触发条件：paseo 的 provider 进程**活着**时，同一 provider session 被外部进程（用户在终端 `claude --resume`/`omp`/`codex resume`…）继续——两个写者碰同一份 transcript。
> 结论产出前，F8 的 R4 警告弹窗保持「仍要发送」放行（用户自担风险）；结论可能收紧为禁止或自动降级。

## 要回答的问题（每 provider 一节：omp / claude / codex / opencode / pi）

1. **transcript 定位**：session 文件确切路径与命名（`~/.claude/projects/...jsonl` 等）、paseo persistence 里存的是否即此路径、格式版本稳定性。
2. **双开行为**：同一 session ID 两处同时恢复/续写——
   - fork？（后者派生新 session ID，旧文件不再被写 → 两线并存的"假冲突"）
   - 交错追加？（两个进程都往同一文件 append → 消息顺序错乱/parentId 断链？）
   - 锁拒绝？（文件锁/pid 锁直接报错）
   - 实测方法：本机各装 CLI，起 A 会话→另一终端 resume 同一 ID→双方各发一条→检查文件行数/顺序/session ID 变化。
3. **可检测性**：外部进程活着这件事有没有可观测信号（锁文件/pid 文件/文件打开句柄 `openfiles`/`lsof` 等价物，win32=`Get-Process|Handle`?）。
4. **可恢复性**：若发生交错写坏，provider 自带修复/截断容错吗（JSONL 逐行解析器对半行的容忍）。

## 产出物

- 每 provider 一张行为表：`双开结果 / 数据损坏风险 / 检测信号 / 建议策略（降级|报冲突|禁止外部续写|放行）`。
- 对 F8 的约束回写：R4 弹窗文案与「仍要发送」去留；R2-full 是否值得实现（若全部 provider 都是 fork 语义=无数据危险，R2-full 可以永远不做）。

## 纪律

调研在隔离 worktree/临时目录做，不碰生产 daemon；每 provider 实测帧/文件 diff 存 `evidence/R2-full/`；结论一节一 commit。
