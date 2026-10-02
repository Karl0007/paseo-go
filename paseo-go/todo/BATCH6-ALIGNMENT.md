# 批次六 对齐记录（用户反馈 → 查证 → 拍板 → 拆卡）

> 基线 HEAD=e3238fbdf（批次五收口，生产=go.8，Releases go.8）。模式同前：当场落盘、代码实证、对齐后拆卡。

## 第一轮反馈（2026-10-02 03:0x，手机=go.8 新包，连生产）

- **F18 标题不是原生名**：用户从未重命名，但列表显示的是首条 prompt 文本（「看一下当前工程，…」「杂交图全部跑完了…」），**不是 F12 拍板的 `项目(worktree)` 默认格式**。截图=本条附图（5 行全部 prompt 式标题+「未知」pill）。
- **F19 两问**：①「暂无消息」行点开出现「正在同步对话」进度条——**同步何时触发？是否每次点进都要来一遍？**②**现在判定为外部会话的条件是什么？**（截图所有行=「未知」，含正在运行的本会话 b0e1e6f7——生产已是 go.8，运行中 agent 显示「未知」本身可疑。）

## 查证结果（代码实证）

### F18 根因（已锁定）

- `chat-list-row.tsx:322` 把 `note=agent.title`，而 **daemon 出生时自动把首条 prompt 截 60 字写成 title**（`create-agent-title.ts` deriveInitialAgentTitle→`config.title=provisionalTitle`）。用户没重命名，provisional title 冒充「备注」→ 整行显示 prompt 文本。
- 服务端本有 explicit/provisional 之分，但**持久化时坍缩成单 title 字段**（无来源标记）→ 壳无法区分。用户真重命名=壳本地 alias（优先级本来正确）。

### F19-Q1 同步触发条件（已锁定，官方机制非壳 bug）

- 打开会话屏→`ensureAgentIsInitialized`：该 agent 时间线在 **app 内存 store** 未同步过→拉 timeline=「正在同步对话」。
- **不是每次**：同一 app 运行内同步过一次，再开秒进；重新触发=app 冷启后首开 / daemon 重启或断线重连（historySyncGeneration 代际推进）。用户刚经历 app 更新+daemon 02:44 重启 → 每个 agent 首开都同步一次=预期一次性成本。
- 「暂无消息」行=pre-B4 记录 preview NULL → 首开全量 timeline 拉取，进度条最明显；开完 sticky/derive 链会补上小字。

### F19-Q2 外部判定条件 + 「未知」泛滥根因（bug 已锁定）

- 现规则：**paseo**=daemon 持有活的 provider 进程（spawn/resume/reload acquire 时打戳）；**external**=daemon 不在写时 transcript 文件变化（fs.watch+stat 轮询）；**none**=无外部证据的保守初值；壳映射：none/缺失→未知。
- **bug**：pre-B4 老记录无 ownership 字段→`projectStoredOwnership` 一律投影 `none`→**全列表永远显示「未知」**，且没有任何再观察路径（watcher 只在活体 agent close/turn-fail 时 attach，存量 idle agent 无人看管）——连真正外部续写的会话也显示未知而非外部。运行中的本会话显示未知=daemon 重启后我是孤儿进程，daemon 未 acquire 未观察。
- 修复方向：daemon 启动/列表时给**存量 agent 批量 attach transcript watcher**（有 transcript 路径者，带上限与节流），ownership 数秒内自愈 未知→原生/外部/无；活体进程直判 paseo。

## 拍板（2026-10-02 03:2x）

- **D21（F18）**：备注**只认壳重命名**（alias，截图=重命名屏「留空恢复默认」）。agent.title（含 daemon 自动 provisional）一律不进列表标题。实现细节自决。
- **D22（F19）**：按自愈口径修，实现自决。编排者裁定语义升级：pill 回答用户的真问题「原生还是非原生」=**出生轴+活写者覆盖**——活体外部写→外部；daemon 持活进程→原生；空闲无证据→按出生（launch→原生 / import→外部 / 出生不可考→未知）。配套：daemon 启动批量 attach 存量 watcher（上限+节流），消灭「全列表恒未知」。
- 开工指令：走 todo pipeline（实施→review→门禁→go.9→生产持久化切换）。

## 追加反馈 F20（2026-10-02 08:09，go.9 包）

- **更新横幅位置错**：「发现新版本 Paseo Go 0.10.2-go.9，点击查看下载」直接压在**系统状态栏**上（时间/VPN/WiFi/电量图标与文字重叠，截图附图）。应为状态栏下方安全区内。
