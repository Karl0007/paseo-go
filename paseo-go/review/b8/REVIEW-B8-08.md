# REVIEW-B8-08 [P2] 导入行无障碍朗读串漏「可能活跃」（F23 引入退步）

## 现象

读屏用户听不到导入行「可能活跃」chip（改前无 label 行反而朗读子文本）。

## 根因

`import.tsx:218` rowLabel 四项无 looksActive chip；R4-13 纪律=label 替换全部子文本。fixture 默认 looksActive:false 整体零覆盖。

## 修复方向

chip 文案并入 rowLabel，顺序=视觉序（标题→可能活跃→副标题→时间→徽标）。

## 验收

renderCell 传 looksActive:true 断言 label 含 activeBadge 文案（修复前必红）。
