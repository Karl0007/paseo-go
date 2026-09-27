# C35 [daemon域] refresh_agent 对 omp 导入会话：新轮次不重放 + closed 后目录掉出

## 现象（用户可见后果，C24 真机实锤）

对 omp 导入会话执行「刷新」（`client.refreshAgent`）：toast 成功、daemon agent 记录 updatedAt 前进，**但 app 时间线尾部仍是追加前内容**（CLI logs 复核 daemon 侧 rehydrate 后的 timeline 同样旧）；且该 agent 刷新后 `lastStatus=closed`、**从 daemon 活跃目录消失**（CLI ls --all 亦无、对话列表行掉出）。= 刷新功能对用户"看起来成功、实际没刷新"，还会弄丢列表行。P1。

## 复现链（C24 evidence 在案）

`paseo-go/evidence/C24/13-refresh-toast-plus-daemon-finding.png` + 时间戳：omp `-r <源jsonl> --no-tools -p "…probe…"` 真实追加一轮（mtime/新轮次/session_exit 记录俱在）→ app 刷新 → toast ✓、updatedAt 前进 ✓、timeline 尾旧 ✗、agent closed+目录掉出 ✗。

## 根因候选（逐一定性，daemon 域）

1. `reloadAgentSession(rehydrateFromDisk)` + `hydrateTimelineFromProvider` 对 omp provider 的重放范围：omp `streamOmpHistory` 读 `readActiveOmpEntryChain`——**session_exit 记录/新追加链是否让 active branch 解析改变**？或 timeline epoch 未真正清（对照 agent-manager.test.ts "replaces the injected timeline store" 的既有语义）。
2. 刷新触发 resume/attach 路径把 omp 会话判为 closed（`omp -r … -p` 跑完即退出，daemon 侧 attach 到已死进程/文件尾 → lifecycle closed）→ 目录可见性按 closed 过滤 → 掉出。**closed 与"掉出目录"哪个是根因哪个是伴生，要拆清**。
3. claude/codex 导入会话同链是否复现（provider 差异定性，决定修复面）。

## 修复方向

根因级；候选修法（以定性为准）：refresh 对 omp 走纯文件重放不 attach 进程；closed 的导入 agent 目录可见性修正（导入会话 closed=常态，不该掉出活跃列表——对照对话 tab 对 closed 的过滤语义）。禁特判糊测试。

## 验收

1. 复现脚本（C24 链原样）转回归测试（daemon 侧：refresh 后 timeline 含新轮次 + 目录仍可见）。
2. 三 provider（omp/claude/codex）行为矩阵实测记录。
3. 真机：app 刷新→时间线增长实拍（补 C24 验收②欠的这半环）。
4. 恰一次 commit；报告 JSON。

## 范围

- 动：`packages/server/src/server/agent/**`（agent-manager reload/hydrate 路径、omp provider streamHistory）、就近测试
- 不动：壳 UI（C24 动作层已正确）

## 证据与验收状态（2026-09-27 补齐；修复 commit `f7ed26b1`）

证据目录：`paseo-go/evidence/C35/`（4 件）

- `daemon-log-timeline.md` — daemon.log 关键时间线摘录：C24 真机现场（09:17–09:25 三连刷 + 09:20:54.844 设备侧归档 RPC=掉目录真凶）+ 修复后探针运行段（09:53–09:56，devd 重启→import→refresh 成功→清理）
- `omp-jsonl-765-771-exit-fork.md` — 源会话 journal 行 765–771 session_exit 分叉记录（行号+关键字段摘录，无隐私全文）：`leaves.at(-1)` 被 exit-only 兄弟分支抢走的现场实锤，时间戳与 daemon.log 事件 ±30ms 对咬
- `probe-ws-roundtrip.md` — 探针 WS 往返摘要：import→真实 omp fork 追加→refresh→timeline 含 probe 轮次（epoch 前进）+ 目录 listed=true/status=idle/archivedAt=null
- `provider-matrix.md` — 三 provider 定性矩阵：omp 有病已修 / claude 同链无病（e2e 实跑绿）/ codex 结构性免疫［INFERENCE，代码定性］

验收状态：

1. 复现链转回归测试：**在案**（f7ed26b1：history-mapper.test.ts 两单测 + daemon e2e `omp-import-refresh-fork-replay.e2e.test.ts`，均证修复前失败=C24 症状逐字复现）
2. 三 provider 矩阵实测记录：**在案**（`evidence/C35/provider-matrix.md`；codex 行为 INFERENCE 标注，理由见文内）
3. 真机 app 刷新→时间线增长实拍：**在案**（CLOSE-DEV1 设备窗口闭环，见下「真机③闭环」节；此前 daemon 侧等价链由真机探针闭环 `probe-ws-roundtrip.md`）
4. 恰一次 commit + 报告 JSON：修复轮=f7ed26b1（报告已交）；本证据补齐轮=独立 docs commit

## 真机③闭环（CLOSE-DEV1 设备窗口，2026-09-27 22:22，AHPEBB1826005071 + metro HEAD bundle）

- 链：omp 真会话（`C:\tmp\close-dev1-probe`，`omp --no-tools -p` 生成）→ app 导入（CLI import 同 RPC，带 C22 章）→ 首次打开走分叉确认（顺带完成 R2-10 复验，见 CLOSE-DEV1 报告）→ PC 端 `omp -r <源jsonl> --no-tools -p` 追加两轮（「say ok」+「C35 ui-refresh marker」，文件 2024→4812→6115B）→ app 胶囊 ⋯「刷新」。
- 实拍：`evidence/CLOSE-DEV1/c35-01-before-refresh.png`（时间线尾=「R2-10 dialog-window activity」，marker 命中 0）→ `c35-02-after-refresh.png`（时间线长出「say ok」+「Reply with exactly: C35 ui-refresh marker」→「C35 ui-refresh marker」，dump 命中 2）；刷新后行不掉目录（agent 仍在列表）。
- 断言脚本+日志：`C:/tmp/c34/r35.sh` / `log-r35.txt`（marker before=0 / after=2）。
- 验收③状态改：**在案**（v0.1.0 遗留欠账清偿；daemon 等价链 + 真机 UI 半环双绿）。
