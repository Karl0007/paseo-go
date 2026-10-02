# REVIEW-B8-01 [P1] 导入屏说明行 M 与屏上行数不同轴（合并 RvUi-U1/RvCorrect-C3/RvChain-H2/RvUi-U5）

## 现象

「列表展示最近 200 条」而屏上折叠树只有 27 行；搜索态 M 变命中数仍称「最近」；F24 要消的歧义多出第三个数（40/200/27）。en 长句窄屏 numberOfLines=1 尾部被砍 [未证实]。

## 根因

`import.tsx:863 shown={rows.length}`（去重返回条目数，窗满必 200）；屏渲染 `visibleItems=applyImportTreeCollapse(...)`（import.tsx:566）；搜索态 rows 被 query 过滤（import.tsx:486）而说明行无感知。

## 修复方向（编排者裁定=D6 设计自主）

shown 绑 `visibleItems.length`（与「列表展示」同轴）；搜索态换命中口径文案（zh「共 {count} 个会话已是你的 agent · 命中 {shown} 条」/en 同构）；Text 允许两行（numberOfLines=2）。

## 验收

折叠树 fixture（200 条目→27 可见根行）断言 M=27（修复前必红 200）；搜索态例断言「命中」措辞（修复前必红「最近 3 条」）；≤411dp en 帧或截断契约测。
