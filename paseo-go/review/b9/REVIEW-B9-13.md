# REVIEW-B9-13 [P3] 子任务徽标 a11y 只钉 toContain，念读顺序未钉（B8-08 全串先例）

## 修复方向

chat-list-row.test.tsx:353-357 升整行 aria-label 全串 toBe。

## 验收

badge 词挪位变异必红。
