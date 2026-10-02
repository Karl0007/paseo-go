# REVIEW-B9-14 [P3] 导入屏别名取源接线（serverId:agentId 键构造）零测

## 现象/根因

import.tsx:583-587 读侧键形内联复制，写侧键形在另一处钉——键构造改坏则 F30 别名优先静默退化。

## 修复方向

屏级测 seed pins store aliases+imported badge 断言行标题=别名；或 aliasForBadge 提纯函数钉键形。

## 验收

去 serverId 前缀变异必红。
