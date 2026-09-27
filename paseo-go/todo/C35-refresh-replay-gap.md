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
