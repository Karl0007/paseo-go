# REVIEW-B8-03 [P2] 环出场 140ms 窗内 land 无条件导航，用户点按被劫持

## 现象

滑动提交后出场动画期间用户点 tab/点会话行，land 仍 navigate 回环目标格，刚 push 的详情被弹掉。

## 根因

`use-shell-ring-swipe.ts:228-233` 完成回调 `runOnJS(land)`，land（:153-161）无条件 armRingTransition+navigate；turningSv 只挡新手势不挡导航动词。跨 tab 劫持为 F26 环扩格新引入（B4 段内滑只 setFilter 无害）。

## 修复方向（根因级）

land 前复核出发条件：JS 侧读 `getShellFrontmostSection()`，非本 hook section 则丢弃提交（tx 归零、清 turning、不 arm 不 navigate）。

## 验收

提交后 land 前注入 frontmost 变更，断言 router.navigate 未调 + tx 复位（修复前必红）。
