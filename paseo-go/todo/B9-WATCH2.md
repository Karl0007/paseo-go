# B9-WATCH2 目录洪泛下 resume 链跟丢：外部在跑却显原生（F33）

## 症状（用户截图 20:3x，手机 go.11/生产 go.11）

IdleGame 置顶行（预览「15/20 读图判净…」）=paseo 出生（显原生合理），但用户**此刻在 PC 终端跑着它**，pill 不回「外部·运行中」。

## 头号嫌疑（卡内先实锤）

F28 走链成本闸：目录 >64 transcript 时 chase 只读「比父新」候选的**最近 24 个头**。IdleGame 目录被视频编辑批的**子代理 transcript 淹了**（几十个新文件都比 resume 子文件新）→ 子文件落窗外 → 链跟丢 → watcher 卡静默父文件 → 从未见外来字节 → 永远原生。次要候选：attach 时链已深、persistence handle 指错目录、生产 go.11 启动 sweep 与用户 resume 的时序。

## 诊断步骤（生产只读取证，daemon 就在本机）

1. `C:/Users/K/.paseo/daemon.log` grep 该 agent（IdleGame，周二创建，标题/预览对上截图）的 attach/`followed the omp resume chain`/ownership 事件。
2. 数 `F:\Gd\IdleGame` 对应 transcript 目录（omp sessions 目录按 cwd 分桶）：文件数、该会话的 resume 链（头 parentSession 串）、链尾 mtime 是否=此刻在写。
3. 对照 watcher 现状挂的文件（log 里 attach 路径）→ 定窗口漏/时序漏/别的。

## 修复方向（按诊断选，根因级）

- 窗口漏 → chase 改**定向查找**：候选按「头里 parentSession==父 sessionId」匹配本来就是语义，问题只在读多少头。改法：把「最近 24 个头」换成「比父新的全部文件先按 mtime 排序读头，命中即停，上限提到 N=200 且**命中后记住链尾路径**（后续 chase 先 stat 已知子路径，不再扫目录）」；或 attach 时一次性建目录内 parentSession 反向索引（同 sweep 复用）。
- 时序漏 → 启动 sweep 的 attach 目标解析同样走新逻辑。
- 验收必含：**复刻洪泛目录**（1 父 + >24 个更新的无关 transcript + 1 个真子）下 chase 在 30s 档跟上的单测（修复前必红）。

## 文件域

`server/agent/transcript-watch-service.ts`、`server/agent/providers/omp/session-descriptor.ts`(+tests)。非目标=客户端、导入屏、手势。**生产只读**：不改生产 home/盘上文件；修完在 devd9 验证，生产生效随 go.12。

## 门禁/证据

scoped `npx vitest run src/server/agent`（排除 e2e）绿+server typecheck+oxlint；真机/devd 帧=洪泛场景下 pill 翻外部（或纯单测+daemon.log 取证文档替代，如实报）；恰好一次 commit（令牌制）。报告 JSON 含 diagnosis 字段（实锤的根因一句话）。
