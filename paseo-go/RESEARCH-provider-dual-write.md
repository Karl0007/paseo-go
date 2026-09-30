# RESEARCH: Provider 双写者语义调研（R2-full 前置）

> 状态：**已结论**（2026-09-30 B4-RESEARCH 五 provider 实测完成，见文末结论节）。
> 触发条件：paseo 的 provider 进程**活着**时，同一 provider session 被外部进程（用户在终端 `claude --resume`/`omp`/`codex resume`…）继续——两个写者碰同一份 transcript。
> 结论产出前，F8 的 R4 警告弹窗保持「仍要发送」放行（用户自担风险）；结论可能收紧为禁止或自动降级。

## 要回答的问题（每 provider 一节：omp / claude / codex / opencode / pi）

1. **transcript 定位**：session 文件确切路径与命名（`~/.claude/projects/...jsonl` 等）、paseo persistence 里存的是否即此路径、格式版本稳定性。
2. **双开行为**：同一 session ID 两处同时恢复/续写——
   - fork？（后者派生新 session ID，旧文件不再被写 → 两线并存的"假冲突"）
   - 交错追加？（两个进程都往同一文件 append → 消息顺序错乱/parentId 断链？）
   - 锁拒绝？（文件锁/pid 锁直接报错）
   - 实测方法：本机各装 CLI，起 A 会话 → 另一终端 resume 同一 ID→ 双方各发一条 → 检查文件行数/顺序/session ID 变化。
3. **可检测性**：外部进程活着这件事有没有可观测信号（锁文件/pid 文件/文件打开句柄 `openfiles`/`lsof` 等价物，win32=`Get-Process|Handle`?）。
4. **可恢复性**：若发生交错写坏，provider 自带修复/截断容错吗（JSONL 逐行解析器对半行的容忍）。

## 产出物

- 每 provider 一张行为表：`双开结果 / 数据损坏风险 / 检测信号 / 建议策略（降级|报冲突|禁止外部续写|放行）`。
- 对 F8 的约束回写：R4 弹窗文案与「仍要发送」去留；R2-full 是否值得实现（若全部 provider 都是 fork 语义=无数据危险，R2-full 可以永远不做）。

## 纪律

调研在隔离 worktree/临时目录做，不碰生产 daemon；每 provider 实测帧/文件 diff 存 `evidence/R2-full/`；结论一节一 commit。

---

## 结论（2026-09-30 实测，B4-RESEARCH；证据 `paseo-go/evidence/R2-full/`）

实测环境：本机 CLI 版本 claude 2.1.201 / codex 0.139.0 / opencode 1.15.10 / pi 0.82.1 / omp 18.1.18。全部隔离目录（CLAUDE_CONFIG_DIR / CODEX_HOME / --session-dir / PI_CODING_AGENT_DIR + 临时 cwd），未触生产 daemon 与真实项目会话。每 provider 均做了「A 活进程持会话 → B 外部 resume 同一会话各发一条 → A 再发一条 → 检查文件/DAG/句柄/截断容忍」全流程；A 用 paseo 同款驱动（claude=stream-json stdin、codex=app-server JSON-RPC、omp/pi=--mode rpc、opencode=serve HTTP）。

### 行为表

|              | transcript                                                                                                                                                      | 双开结果                                                                                                                                                                                   | 数据损坏                                                                                                           | 检测信号（外部进程活着）                                                                                          | 截断容忍                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **claude**   | `~/.claude/projects/<cwd>/<sid>.jsonl`，uuid/parentUuid **DAG**；paseo 存 sid 且自算同路径（真双写：读/rewind 写/删都直接碰文件）                               | resume 默认**同文件续写**；活进程 A 不重读 → A 的新消息挂**自己旧叶** → **同文件分叉**；下次 resume 选**最深分支**（实测选中外部 B 支，**A 支被静默弃**）；`--fork-session` 干净派生新文件 | 无字节损坏；但**分支静默丢失**=语义损坏最重；半行损坏时**新写入与坏行粘连**（丢一条好行）                          | **最佳**：`~/.claude/sessions/<pid>.json` 活进程注册表（pid/sessionId/cwd/startedAt，退出即删）；文件本身不持句柄 | 读取跳过坏行可续；写入不自愈                                           |
| **codex**    | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl` **线性日志**（无 parentId）；paseo 只存 thread UUID，全走 app-server RPC（thread 对象自带 `path`） | resume=同文件追加；A 活 + B 外部写：双方线性交错落盘，**无分叉无丢失**；但 A 内存上下文**看不见** B 的轮（实测 A 答"上一条用户消息"=自己的，非 B 的 ZEBRA）                                | 无（线性）；风险=两写者语义上下文分叉，文件本身可完整回放                                                          | 活 app-server **持有 rollout 文件句柄**（独占打开失败）+ state_5.sqlite 锁；无 pid 注册表                         | 读取跳过坏行；写前先换行（不粘连）                                     |
| **opencode** | `~/.local/share/opencode/opencode.db`（SQLite WAL，session/message/part 行）；**无 per-session 文件**；paseo 只存 sessionID，全走 HTTP                          | 两 server 共写一库：SQLite 写锁串行化，实测 4 路并发写全落库、**零丢失零 fork**；读视图=共享 DB（A 能读到 B 的行）→ **无双写者语义问题**                                                   | 无（事务引擎，半行不可达）                                                                                         | 无进程级信号（DB 行 time_updated 只能做 mtime 启发）                                                              | N/A                                                                    |
| **omp**      | `~/.omp/agent/sessions/<cwd>/<ISO>_<uuid>.jsonl`，id/parentId **DAG**；paseo persistence=**该文件路径**（nativeHandle），resume=回灌 `--session <path>`         | **冷** resume 重读文件（外部支可续）；**活**进程不重读 → 同文件**分叉**（实测 A2 与 B 互为兄弟）；omp 原生 resume 选**文件序最后叶**（活写者支保命、外部支被弃）；`--fork` 显式派生        | 无字节损坏；外部分支静默出上下文；paseo 已有 `selectActiveOmpLeaf` 兜 Replay 侧（history.ts:328-334 注释即此问题） | 活进程**持有会话文件句柄**（独占打开失败）；`~/.omp/run/daemons/` 是 daemon 注册表、rpc 会话不登记                | **最好**：读跳坏行 + 写前**自愈**（截断行被丢弃，resume 后全文件有效） |
| **pi**       | `~/.pi/agent/sessions/<cwd>/<ISO>_<uuid>.jsonl`，同 omp 家族 DAG；paseo persistence=文件路径                                                                    | 与 omp 逐字相同：活进程分叉、文件序最后叶获胜、`--fork` 可用                                                                                                                               | 同 omp                                                                                                             | **最弱**：不持句柄（实测独占打开成功）、无注册表 → 只剩 mtime/size                                                | 读跳坏行、写新起一行（坏行残留但无害）                                 |

### 对 F8 的约束回写（建议）

1. **R2-full「互斥/双写者协议」不值得做**：五家没有任何一家发生字节级损坏或写入失败（opencode 事务化、其余 append-only 行级安全）。危险全部集中在**语义层**（分支被弃/上下文分叉），互斥协议解决不了它。**建议 R2-full 永久关闭**，把预算并回 R2-lite/R3。
2. **R4「仍要发送」保留，但文案与策略按 provider 分级**（`external+looksActive` 时）：
   - **claude**：唯一有「活写者分支被下次 resume 弃掉」实锤的 → 弹窗保留且**建议改为「从该会话分叉」= 自动带 `--fork-session` 发送**（R5 路径），双线并存、零丢失，用户无需理解 DAG。
   - **omp/pi**：paseo 侧本来就以「文件序最后叶」为准，paseo 发送=把活路抢回自己线上，外部支受损而 paseo 支安全 → 现警告文案够用，放行合理。
   - **codex**：线性日志无丢行，风险=两终端各说各话 → 警告可弱化为「对方看不到你这条」。
   - **opencode**：共享 DB、互相可见，**建议免弹窗直接放行**（R4 对 opencode 是纯噪音）。
3. **R2-lite 的 looksActive 升级信号**（比 mtime 准）：claude 扫 `~/.claude/sessions/*.json`（sessionId→pid，进程存在=活）；codex/omp 用「独占打开 transcript 失败」探句柄；pi/opencode 维持 mtime 启发。实现均为只读探测，符合 R2-lite 预算。
4. **格式稳定性**：claude jsonl 含 `last-prompt/mode/queue-operation` 等易变元行且版本活跃（2.1.x）；omp/pi 头部 `type:session` 无 schema 版本字段——R3 watcher 的 tail 解析必须继续「未知 type 跳过」纪律。

### 勘误/边界

- claude 本机订阅 403（NOTIFY.md 在案），模型轮以「错误响应仍完整落盘 transcript」形态完成实测——文件机制结论不受影响；「下次 resume 选哪支」由文件 DAG 复现验证，非模型行为。
- opencode 默认 go 模型间歇 400（Privacy/Global 区域设置），并发写实测以「错误 assistant 行也落库」完成，行级结论不受影响。
- pi 无凭据，实测经临时 OpenAI 兼容网关（隔离 PI_CODING_AGENT_DIR），会话文件机制与 omp 同构已双重确认（同文件族 + 同 leaf 规则复现）。
- codex TUI 交互输入在 PTY 下不可靠（渲染乱码），TUI 路径的 resume 语义以 `codex exec resume`（同 app-server 内核）+ TUI 启动即加载同 thread（无新文件）联合推定；差异风险低。
