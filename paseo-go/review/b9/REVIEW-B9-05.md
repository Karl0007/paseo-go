# REVIEW-B9-05 [P2] 导入子行实况 overlay 用陈旧 watcher mtime 压掉新鲜估算，刚复燃子代理显静默最长 5min

## 现象/根因

import-sessions.ts:242-247 用 subagentLiveState 布尔**无条件覆盖** looksActive；watcher 的 writes 缓存=上次扫描 tick（:886-904），扫描后新写→watcher=false 而现 stat 估算=true→陈旧负判定压掉新鲜正证据。方向性：watcher=true⇒estimate=true，唯一不一致方向就是这个错误降级；「双向替换」单测用任意 fixture 掩盖了不对称。

## 修复方向（编排者裁定=A）

负判定不得压过正估算：仅 `live===true || payload.looksActive!==true` 时应用 overlay（衰减 goes dark 不受影响：无新写两源同式同值）。

## 验收

attach 观察（首扫子 stale）→扫描后 touch 子→listImportable：looksActive===true（修复前 false 必红）。

## 复核（复核 Agent 填）


结论：CONFIRMED（P2 维持）

理由/证据：
1. 链核实：import-sessions.ts:242-247 无条件覆盖确认；subagentLiveState（transcript-watch-service.ts:886-904）按上次扫描缓存的 mtime 判定；估算每次 list 现算（session-descriptor.ts:287 scannedAt-mtime<窗）；fs.watch 只盯父文件（transcript-watch-service.ts:633），子写不触发 check，quiet 父的树扫节奏=5min（DEFAULT_CHAIN_FOLLOW_INTERVAL_MS）→ 陈旧窗最长 ~5min（+60s sweep 粒度），卡数字准确。
2. 方向性论证核实：mtime 单调不减 ⇒ watcher=true 蕴含 estimate=true，(true,false) 在真实 watcher 下不可达；(false,true) 仅扫描后新写窗可达——即 overlay 在真实数据上唯一可观察的效果就是这个错误降级，「双向替换」单测（import-sessions.test.ts:1626-1687）用任意 fixture 掩盖了不对称，卡判断成立。
3. 实证（真 service + 真 listImportableProviderSessions 探针，跑完即删）：首扫缓存 stale 子 → utimesSync(child, now) → 无 overlay 通道时 looksActive===true（新鲜估算成立），接真 watcher overlay 后 looksActive===false（=卡成立）。
4. P2 成立：误导为暂时性（下一扫自愈），仅导入页「可能活跃」chip；修复方向 A（仅 live===true || payload.looksActive!==true 时应用 overlay）不影响衰减 goes dark（彼时两源同式同值 false）。
