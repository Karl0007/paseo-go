# REVIEW-B9-01 [P1] 子树通道无 attach 基线：paseo 自跑子 agent 在 turn 后被误判外部运行

## 现象

app 里跑 omp 会话派子代理，turn 结束 ≤60s pill 翻「外部·运行中」+徽标，5min 衰减后**停在外部**直到下次 acquire；期间发送还吃 R4 误报警。close 路径同翻。双路撞车（Rv9Hygiene#1+Rv9Correct#1）。

## 根因

链通道有 attach 静默基线（transcript-watch-service.ts:693-698 cursor===null 播种），树通道首观察分支（:694-701）把「attach 时 mtime 新鲜子」无条件当外来证据（refreshSubagentTree:821/846 绝对 mtime 窗，无 attach 时间地板）→ reportSubagentActivity(:866)→ownershipOnExternalChange(agent-ownership.ts:188，其注释「只喂 paseo 没写的字节」被树违反)→external(:96-104)。B9-SUBACT 卡验收「daemon 自写不误计」未实现。

## 修复方向

树补同款基线：candidate 携带自写时刻/最后写者事实，attach 首扫对自写会话静默播种新鲜集只报其后移动；发现式 attach（非自写）保留 live-evidence。组合 acquire/turn-start 清零投影治徽标冻结。

## 验收

manager+watcher 集成测：live-idle omp 写子(mtime=now)→turn 结束→sweep：ownership 仍 paseo、ela=false、payload 无计数；released close-attach 同断言；现有「attach 后新子→传染」「重启发现外部活跃」保持绿。修复前必红。

## 复核（复核 Agent 填）


结论：CONFIRMED（P1 维持）

理由/证据：
1. 因果链逐跳核实：turn 结束 live-idle 仍进 watch 候选（agent-manager.ts:4053-4071，baselineBytes=live.ownership.baselineBytes，acquire 后=null）→ attach cursor===null → 首观察分支（transcript-watch-service.ts:694-701）对 subagent?.changed && count>0 无条件 reportSubagentActivity(:866-875)；refreshSubagentTree(:812-838) 用绝对 mtime 窗（LOOKS_ACTIVE_MTIME_WINDOW_MS=5min，provider-transcript.ts:47），确无 attach 时间地板 → onChange items=[] → applyLiveTranscriptChange(:4193-4194) ownershipOnExternalChange → derive(:96-104) 翻 external+ela=true。
2. 实证（一次性 vitest 探针，manager+watcher+真实文件，跑完即删）：resume omp agent（idle、ownership=paseo、cursor 已清）→ 写新鲜子（mtime=now，模拟本 turn 自写）→ 一次 sweepTranscriptWatch → 断言 ownership.value==="external"、externalLooksActive===true、activeSubagents===1 全通过（=卡成立）。服务级探针：attach（baselineBytes=null）且新鲜子已存在 → 立即一条 change {items:[], activeSubagents:1, externalLooksActive:true}。
3. 未被既有测挡：race-1 测（agent-ownership.test.ts "never attributes the daemon's own bytes"）只护主 transcript 通道（claude、无子树）；B9-SUBACT contagion 测是外来子的预期形态——自写区分正是「daemon 自写不误计」验收未实现项。
4. P1 成立：app 内任何派子代理的 omp 会话 turn 结束后 ≤60s（sweep 周期）pill 翻「外部·运行中」，5min 窗内发送吃 R4 误报，衰减后停 external 直到下次 acquire。close 路径同型（observeReleasedTranscript → 同一首观察分支）。
