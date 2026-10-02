# REVIEW-B8-11 [P3] serializeAgentAxes present-only 注释与上游行为矛盾

## 现象/根因

注释承诺 absent-vs-null 区分；但 normalizeAgentSnapshot 已把缺键折成显式 null（agent-snapshots.ts:166-176），`!==undefined` 恒真分支不可达。今日无行为害，误导后来者按键缺失判旧行。

## 修复方向（裁定=注释方向）

注释改事实：键恒在；缺键仅存在于本改动前写的行。

## 验收

无测；读码复核注释与 normalize 行为一致。
