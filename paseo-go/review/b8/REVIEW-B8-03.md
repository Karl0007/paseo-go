# REVIEW-B8-03 [P2] 环出场 140ms 窗内 land 无条件导航，用户点按被劫持

## 现象

滑动提交后出场动画期间用户点 tab/点会话行，land 仍 navigate 回环目标格，刚 push 的详情被弹掉。

## 根因

`use-shell-ring-swipe.ts:228-233` 完成回调 `runOnJS(land)`，land（:153-161）无条件 armRingTransition+navigate；turningSv 只挡新手势不挡导航动词。跨 tab 劫持为 F26 环扩格新引入（B4 段内滑只 setFilter 无害）。

## 修复方向（根因级）

land 前复核出发条件：JS 侧读 `getShellFrontmostSection()`，非本 hook section 则丢弃提交（tx 归零、清 turning、不 arm 不 navigate）。

## 验收

提交后 land 前注入 frontmost 变更，断言 router.navigate 未调 + tx 复位（修复前必红）。

## 复核（RevB8）

**CONFIRMED（维持 P2）** — 竞态真实可触发。逐跳核：`use-shell-ring-swipe.ts:233` withTiming 完成回调无条件 `runOnJS(land)`；`land`（:153-161）不读任何闸即 `armRingTransition`+`switchSlotRef.current(target)`（chats 跨 tab = `router.navigate`，chats-screen-body.tsx:591）。turningSv 覆盖面读全 hook：仅 `onTouchesMove` 的 `decideShellSwipe({blocked})` 读它挡新手势，不挡导航动词。出场窗内取消路径穷举：唯一能掐掉动画（finished=false→不发 land）的是 `tx.value=0` 写入，仅出现在 onBeat 的 `focused===section` 分支（:140）——而用户点 rail（frontmost→他 tab）或点会话行（frontmost→null）走的都是 `focused!==section` 提前 return（:122），不触碰 tx；rail/tab bar 在滑动面外、行 Pressable 无 turning 门（turningSv 为 hook 私有无外部消费）。故 140ms 内点按→JS 先落地→land 后发 navigate 覆盖，劫持成立。跨 tab 劫持确为 F26 新增（B4 段内只 setFilter）。修复方向（land 前读 getShellFrontmostSection 复核）与总线语义吻合。
