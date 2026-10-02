# REVIEW-B9-07 [P2] 右缘槽位家族几何手抄（subagentBadge 逐字复制 countBadge 七属性）

## 现象/根因

chat-list-row.tsx:756-765 vs :737-745 七几何属性双份真相；家族纪律只在注释，无测钉等高——与 REVIEW-B8-05 同型。

## 修复方向（编排者裁定=共享基座）

抽 slotChip 基座样式（7 几何属性），countBadge/subagentBadge=[slotChip,色对]；unreadDot 8dp 点档不入基座。

## 验收

改一处高度另一处不跟的变异必红（共享后结构上不可能，测改钉基座消费断言）。
