# REVIEW-B9-12 [P3] race1 对 live-idle attach 缺失真空通过

## 现象/根因

agent-ownership.test.ts:1008-1046 终态 paseo 在「没 attach」与「基线正确」下同值，候选过滤器回退时此测不红。

## 修复方向

race1 末尾补一次外来 append+sweep 断言翻 external（证明是基线正确不是没在看）。

## 验收

移除 live-idle 候选变异下新断言必红。
