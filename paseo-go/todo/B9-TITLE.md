# B9-TITLE 导入行标题/小字改用会话行同款推导（F30）

## 口径（用户：「导入的标题和小字跟会话不一样」）

对齐目标=**会话行终态**（`shell/chats/row-title.ts` 的模型，B4/B5/B6 裁定链）：

1. **标题** = `项目名(worktree)`：与壳会话行同一格式化函数/同源字符串（项目名用现有 resolveDirectoryLabel→projectName，未命中在册项目=deriveProjectName(deriveProjectKey(cwd))，与会话行兜底一致）。**已导入的行**：壳重命名别名优先（读壳 rename store，按 existing 徽标携带的 agentId 查）——同一会话在两屏显示同一串。
2. **子会话行（└）**：项目串与父全同会失去辨识度 → 标题=nameLabel（子代理名），无 nameLabel 回退现 firstUserMsg 链；副标题规则同下。
3. **副标题** = 会话行同款：预览（「我: 」前缀按角色，能取到角色就接，取不到裸预览）+ 空链占位小字（暂无消息），**去掉项目段**（项目已进标题）；「可能活跃」chip 与徽标不动。
4. firstUserMsg 不丢：并入副标题尾段当预览为空时兜底（搜索命中可读性）。

## 文件域

`shell/import/rows.ts`(+test)、`(detail)/import.tsx`(+test)、必要时 `shell/import/use-import-agent-index.ts` 补别名读取。非目标=会话行组件、服务端、手势。

## 验收

- 测：同 cwd 的导入行标题与会话行标题格式化输出逐字相等（复用同函数即结构保证，钉一例防漂移）；已导入+重命名→别名标题；子行 nameLabel 标题；空预览→占位小字；搜索态 firstUserMsg 兜底出现。
- 真机帧：导入屏与对话 tab 并排同屏（同项目行同标题串）；帧存 evidence/B9-TITLE/。
- scoped import 域绿+typecheck+oxlint。**恰好一次 commit**（令牌制）。
