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

- 恰好一次 commit

## 结论（C10 完成 2026-09-25；探源三件 + 壳导入屏实装）

### 探源结论

1. **daemon RPC 名**：导入面是 `fetch_recent_provider_sessions_request` /
   `import_agent_request`（packages/protocol/src/messages.ts:1332、:1784；daemon 侧
   session.ts:2705/:2729 → server/agent/import-sessions.ts）。omp provider 的历史读取函数
   `listOmpImportableSessions`（providers/omp/session-descriptor.ts:74，扫 `~/.omp/agent/sessions`
   下 JSONL），经 `agentManager.listImportableSessions` 汇入统一列表。SDK 面
   `client.fetchRecentProviderSessions()` / `client.importAgent()`（client/daemon-client.ts:2330/:3062）。
   幂等语义在 daemon：列表端已导入 handle 直接过滤并回报 `filteredAlreadyImportedCount`
   （import-sessions.ts:155-159）；重复 import 抛 `Provider session is already imported`（:215）。
2. **官方 UI：有组件、无路由。** `ImportSessionSheet`（components/import-session-sheet.tsx，
   底部弹层）+ `useImportSession` hook（hooks/use-import-session.tsx）——官方入口是
   command-center/left-sidebar 弹层，**没有可 push 的导入路由**。按裁定落壳屏：
   `(shell)/import.tsx` 调 SDK + 复用官方纯逻辑件（view-model 的标题/预览/目录标签链、
   useHostChooser 多主机弹层、useProvidersSnapshot/useHostProjects/getProviderIcon）。
3. **dev daemon omp provider 实况**：`provider ls --json` = omp 已注册但
   `status: unavailable, enabled: Disabled`（默认禁用；`provider diagnostic omp` 报
   "Bun runtime: unavailable; npm-installed OMP requires Bun >= 1.3.14"，omp.exe 本体
   18.1.18 可寻）。`importAgent` 走 `requireAvailableClient`（agent-manager.ts:1430）→
   omp 会话既不可列也不可导入。**known_issue（数据前提）**：本机补装 Bun≥1.3.14 并在
   daemon 启用 omp 后，omp 历史（~/.omp/agent/sessions 5451 个 JSONL）即可走同一条链路导入，
   壳侧零改动。真机验证改用同链路的其他 provider 真实历史（见下），未造假数据。

### 实装

- `(shell)/import.tsx` 隐藏 tab（C5 KI-2 模式，`_layout.tsx` 注册 `href:null`）：
  进屏官方 chooser 选 host（单 host 自动选中）→ 列表（provider 图标/标题/项目·相对时间/预览）
  → 勾选多选 → 底部「导入（n）」→ 逐条 `importAgent` 进度「正在导入 i/n」→
  结果 toast（已导入 n · m 条此前已导入 · k 条失败）→ 回对话列表（新条目 unread 出现，
  点开走 C4 opener，timeline 完整）；重复导入的条目由 daemon 过滤不再出现，
  竞态下的重复 import 按错误文案归类为幂等提示（classifyImportError）。
- 纯逻辑 `src/shell/import/rows.ts`：行映射（key=providerId:handleId、去重+动态倒序）、
  勾选态 toggle、状态行判定 deriveImportStatus、结果分类/汇总；单测 12 例。
- ＋菜单接线：chats.tsx `handleImportChat` push `SHELL.import`（routes.ts 登记）；
  删除 importSoon 占位 toast；locales 双语新增 `import.*` 节。

### 验证

- 数据前提（C:/tmp/c10-probe.ts 直连 dev daemon）：`fetchRecentProviderSessions` 真实返回
  10 条（codex×8、claude×1、opencode×1）+ filteredAlreadyImportedCount=11 +
  providerErrors 仅 copilot（命令未装）。
- 真机（BRT-W09）：导入 3 条真实历史（claude「查看 git status」、codex「C5 host2 OK」、
  codex「C3 seed A」）→ 对话列表顶部出现（paseo · now + 未读点）→ 点开 timeline 完整
  （用户消息+回复+Worked for 1m+composer）→ 重开导入屏，3 条已从列表消失（幂等过滤）。
- 读图 `evidence/C10/` 7 张：host 选择弹层 / 导入列表 / 勾选 2 条 / 进度 0-1/n /
  toast「已导入 2 条会话」+列表新条目 / 新条目行 / 导入后 timeline。
- W1 stash 对照：`.dev/c10-suite-a.txt`（基线）vs `.dev/c10-suite-b.txt`（含改动），
  失败集合一致=无新增失败（对照结论写进卡外报告）。
