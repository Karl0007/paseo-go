# B6-TITLE 备注只认壳重命名（F18/D21）

## 口径

- 列表标题：`alias（壳重命名）> 项目(worktree) 默认格式`。**agent.title（daemon 出生自动=首 prompt 截断）不再作为备注参与拼标题**。
- 改动点=chat-list-row.tsx 的 note 接线（去 agent.title 喂入）+ Ruling 4 注释改写为 D21 口径；row-title.ts 本体不动（note 参数保留给未来显式备注）。
- 重命名屏/菜单标题/删除确认读 alias 的现有链不动；官方端显示不受影响（它们直接用 agent.title，那是它们的原生名）。

## 验收

- 测改钉：无 alias+title=provisional prompt → 显示 `项目(worktree)`；有 alias → alias。
- 真机帧：与截图同场景（老会话无重命名）显示新默认格式。恰好一次 commit。
