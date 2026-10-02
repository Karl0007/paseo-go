# REVIEW-B8-11 [P3] serializeAgentAxes present-only 注释与上游行为矛盾

## 现象/根因

注释承诺 absent-vs-null 区分；但 normalizeAgentSnapshot 已把缺键折成显式 null（agent-snapshots.ts:166-176），`!==undefined` 恒真分支不可达。今日无行为害，误导后来者按键缺失判旧行。

## 修复方向（裁定=注释方向）

注释改事实：键恒在；缺键仅存在于本改动前写的行。

## 验收

无测；读码复核注释与 normalize 行为一致。

## 复核（RevB8）

**CONFIRMED（维持 P3）** — — 因果逐跳核：serializeAgentAxes（replica-cache/index.ts:606-617）注释承诺「the host never reported it stays absent on the row」；但其唯一写路径 :1355 `serializeAgent(upsert.value)` 的 Agent 全部出自 normalizeAgentSnapshot（目录同步）或 deserializeAgent:697（内部同样过 normalize），后者 :166-176 `ownership ?? null`/`externalLooksActive ?? null`/`origin ?? null` 恒把缺键折成显式 null → `!==undefined` 恒真，键恒在，absent 分支今日不可达。无行为害核：StoredAgent schema :258 nullable+optional，缺键与 null 读出同为未知——纯注释误导。裁定=改注释方向成立。
