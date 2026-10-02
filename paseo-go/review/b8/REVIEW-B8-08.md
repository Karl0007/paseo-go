# REVIEW-B8-08 [P2] 导入行无障碍朗读串漏「可能活跃」（F23 引入退步）

## 现象

读屏用户听不到导入行「可能活跃」chip（改前无 label 行反而朗读子文本）。

## 根因

`import.tsx:218` rowLabel 四项无 looksActive chip；R4-13 纪律=label 替换全部子文本。fixture 默认 looksActive:false 整体零覆盖。

## 修复方向

chip 文案并入 rowLabel，顺序=视觉序（标题→可能活跃→副标题→时间→徽标）。

## 验收

renderCell 传 looksActive:true 断言 label 含 activeBadge 文案（修复前必红）。

## 复核（RevB8）

**CONFIRMED（维持 P2）** — import.tsx:218 `rowLabel=[title, subtitle, timeLabel, badgeLabel]` 四项，:223 挂到 Pressable `accessibilityLabel`（RN 语义=label 替换全部子文本），而「可能活跃」chip（:265-267 `t("import.activeBadge")`）渲染在 label 之内、串之外→读屏丢失。改前退步链核：R4-13 注释自陈「此前只有徽标行有 label」——无徽标行原本朗读全部子文本（含 chip），现所有行有 label 而 chip 恒缺席，无徽标+活跃行净退步。覆盖核：import.test.tsx 默认 fixture `looksActive:false`（:57），唯一 true 用例（:119）只钉 DOM 顺序，全库无 activeBadge/rowLabel 断言——零覆盖属实。修复方向（chip 文案并入 rowLabel 视觉序）正确。
