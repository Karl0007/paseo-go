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

结论：
理由/证据：
