# REVIEW-B9-02 [P1] 计数衰减基线随 watch entry 消亡：重启/重挂后徽标×N 与运行中永久卡死

## 现象

released 会话带 activeSubagents=3+ela=true 落库→daemon 重启且停机期子任务全终→重挂首扫 count=0 但 `subagentCountChanged(undefined,0)=false`(:1090-1092) 不说话；调用方 record/live 跨 entry 存活继续投影 3/true→徽标×3+「外部·运行中」永卡（空闲 released 会话等不到下次真实活动）。live 侧 turn-start detach 后重挂同型。

## 根因

「上次已报计数」是 entry 本地内存事实，跨 entry 的调用方状态却是持久的——首扫 undefined→0 沉默规则的前提（调用方也没说过话）被跨 entry 存活打破（transcript-watch-service.ts:1084-1093 + agent-projections.ts:251-254 投影链）。

## 修复方向

根因级：candidate 增带持久化 activeSubagents，attach 时播种 entry.subagentCount（undefined→N 沉默仅对调用方同样无值成立），首扫按真实差值上报（3→0 说话一次）。

## 验收

红→绿：record 持久化 3+ela=true、子全 stale→sweep 后 record=0、ela=false、updatedAt 不变；旧 record 无值+stale 树仍零上报（现测不回归）。

## 复核（复核 Agent 填）


结论：CONFIRMED（P1 维持）

理由/证据：
1. 链核实：subagentCount 是 entry 本地字段（transcript-watch-service.ts:234；attach 置 undefined :392），undefined→0 沉默（subagentCountChanged :1091-1093）；而调用方 record.activeSubagents/externalLooksActive 持久化（agent-storage.ts:93-100）且直接投影上 wire（agent-projections.ts:240、251-254）——沉默规则的前提「调用方也没说过话」被跨 entry 存活打破，卡根因表述准确。
2. 实证（manager 级探针，跑完即删）：upsert record {ownership:"external", externalLooksActive:true, activeSubagents:3, ownershipBaselineBytes=transcript 字节数}，三子 mtime 拨到 7min 前 → 两次 sweep → manager.subagentLiveState(child)===false（证明扫描确实执行并缓存 0，非 attach 失败）但 record 仍 3/true/external（=卡成立）。
3. 无其他发射口：activeSubagents/externalLooksActive 的写只发生在 applyStoredTranscriptChange/applyLiveTranscriptChange（均由 watcher change 驱动）；字节不动、计数不再动的空闲 released 会话永不再触发 → 「永卡」成立。live 侧同型：turn-start detach → 重挂时子已 stale → 首扫 undefined→0 沉默 → live.activeSubagents 冻结旧值（徽标冻结，与卡「组合 acquire/turn-start 清零投影」修复方向对应）。
4. P1 成立：用户可见错误态跨 daemon 重启持续存在且不自愈，需一次无关的外部活动才能纠正。
