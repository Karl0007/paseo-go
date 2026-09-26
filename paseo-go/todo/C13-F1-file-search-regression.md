# C13-F1 文件搜索 release 真机零命中(回归,待修)

## 现象(C13 冒烟,release 包 0.1.0 @ 463e171c)

工作区 tab → 搜索 → 先浏览 paseo-go 根目录(确认 BUILD.md、smoke-release.apk 在列)→ 返回 → 搜 `build`(小写,IME 候选栏提交,输入框确认只有 `build`)→ `shell-workspace-search-empty`「没有匹配的文件」。搜 `BUILD` 同样。C9 真机轮此功能有命中(evidence/C9/C9-08-workspace-dualhost-hits.png),**属回归**。

## 已排除(静态全链核对,均一致)

- 状态键:`buildWorkspaceExplorerStateKey` = `workspace:{id}`(use-file-explorer-actions.ts:47-57),workspace.tsx:202 前缀过滤匹配。
- kind 词表:protocol `z.enum(["file","directory"])`(messages.ts:2688/2770),matcher `kind !== "file"` 跳过目录一致。
- 匹配器:`searchFileNames` 小写子串+排名,file-search.test.ts 单测覆盖。
- store:`sessions: Record<string,SessionState>`(session-store.ts:428),`Object.entries` 可用;`setFileExplorer`(:1766-1774)替换 sessions 身份 → memo 依赖 `[searchActive,sessions,...]` 会重算。
- 状态存活:返回后预览页 favorite 仍读到 `explorerState.selectedEntry`(C13 实测收藏成功)→ 浏览态确在 store 中。
- `searching=true` 成立(空态带 icon 行只在 query 非空时渲染)→ query 非空、searchActive=true、searchFileNames 已执行 → **searchSources 为空**。

## 剩余嫌疑(需 debug+metro 动态断点)

1. `session.fileExplorer` Map 在 workspace.tsx 读到的实例与 body 写入的不是同一个(双 store 实例?metro 路径 vs 打包路径的模块解析差异?)。
2. C12 hydration 竞态修复改变了 `hasHydratedWorkspaces` 前后 `sessions[serverId]` 的重建时机,搜索 memo 捕获的是旧 sessions 快照且后续无身份变化。
3. (detail)/files 路由(C16)传入 pane 的 serverId/workspaceId 与 store 键的规范化差异(trim/case)——但 favorite 路径同键,概率低。

## 复现步骤

release/debug 包:连接 → 工作区 → 打开 paseo-go 文件浏览 → 返回 → 搜索 `build` → 期望命中 BUILD.md,实际空态。

## 验收口径

修复后 release 真机:浏览根目录→返回→`build` 命中 BUILD.md;仅浏览过目录参与(范围提示不变);evidence 截图。
