# REVIEW-B9-15 [P3] 嵌套子树（深度≥2）不在扫描面：孙代理在跑时徽标与传染全盲

## 现象/根因

omp 子代理可再派孙（本仓 history-mapper.test.ts:615 钉了形态）；refreshSubagentTree 单层 readdir+`.jsonl` 过滤，目录项跳过→孙写不计数不传染；导入 overlay 对孙回 null 退估算。[未证实] 生产深度≥2 频率。

## 修复方向（编排者裁定=A）

下钻一层 readdir+stat（成本=现闸×(1+子目录数)，chase 档有界），同步钉 stat 预算上限测；深度 2 封顶（再深退估算，注释写明）。

## 验收

parentStem/Explore/Nested.jsonl 写新→sweep→activeSubagents≥1+ela=true（修复前必红）；「只数第一层邻居不算」不回归；stat 预算有界测。
