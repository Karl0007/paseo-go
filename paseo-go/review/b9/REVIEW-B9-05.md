# REVIEW-B9-05 [P2] 导入子行实况 overlay 用陈旧 watcher mtime 压掉新鲜估算，刚复燃子代理显静默最长 5min

## 现象/根因

import-sessions.ts:242-247 用 subagentLiveState 布尔**无条件覆盖** looksActive；watcher 的 writes 缓存=上次扫描 tick（:886-904），扫描后新写→watcher=false 而现 stat 估算=true→陈旧负判定压掉新鲜正证据。方向性：watcher=true⇒estimate=true，唯一不一致方向就是这个错误降级；「双向替换」单测用任意 fixture 掩盖了不对称。

## 修复方向（编排者裁定=A）

负判定不得压过正估算：仅 `live===true || payload.looksActive!==true` 时应用 overlay（衰减 goes dark 不受影响：无新写两源同式同值）。

## 验收

attach 观察（首扫子 stale）→扫描后 touch 子→listImportable：looksActive===true（修复前 false 必红）。

## 复核（复核 Agent 填）

结论：
理由/证据：
