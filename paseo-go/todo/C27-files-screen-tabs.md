# C27 文件屏改造：头部只留路径 + 页内搜索 + 文件|diff|git 三段页签

## 背景 / 用户拍板

用户（NEXT-requirements Q8）：文件屏顶部 `host › project › workspace` 面包屑"没有意义，只保留项目路径"；页内没有搜索要加；要两个页签：diff 与 git 记录。裁定 DESIGN §14.9。

## 设计裁定（照此执行，不得重开）

1. **头部**（`src/shell/components/files-screen-body.tsx` FilesHeader）：删面包屑三段，改**单行项目路径**（`workspaceDirectory`，尾部路径段优先可见=中段省略 `ellipsizeMode="middle"`）+ 返回键不变；双实例（(shell)/(detail)）行为与返回语义**零回退**（C16 纪律）。
2. **三段页签** `文件 | diff | git 记录`（分段控件，官方既有 segmented 姿势/主题 token）：
   - 文件=现 FileExplorerPane 原样（收藏 chip/长按/预览链路不动）；
   - diff=官方 `src/git/diff-pane.tsx`（DiffPane）——props 从 host-runtime client + workspace descriptor 接线，**复用官方 changes tab 的同一数据通路**（读 workspace-screen 如何挂 DiffPane/changes tab，点名为准，勿另起炉灶）；
   - git 记录=官方 `src/git/commits-section/commits-section.tsx`（`CommitsSection{serverId,cwd,onCommitPress}`）；`onCommitPress` v1=打开该 commit 的 diff 视图（官方若现成有 commit-diff 通路则接；接不动则 v1 列表+长按复制 sha，known_issue 记 sha 级查看降级）。
   - 非 git 目录：diff/git 页签置灰+说明文案（官方 unsupported 态姿势）。
3. **页内搜索**：头部路径行右侧放大镜 → bar morph（C9 姿势）；范围=**本工作区已浏览目录**（复用 `shell/search/file-search` 纯函数 + `collectBrowsedWorkspaces` 过滤本 workspace；空态如实说明范围——协议无文件名 RPC，C9 已探死）；命中→push 既有 `(detail)/preview`。
4. 搜索/页签状态=屏内 state，不入 persist。

## 范围

- 动：`src/shell/components/files-screen-body.tsx`（+拆出的纯逻辑+test）、`src/shell/search/file-search.ts`（如需导出复用面）、locales、（如需）`routes.ts` 无则不动
- 不动：FileExplorerPane/DiffPane/CommitsSection 本体（纯消费）；预览屏；官方文件

## 工程约束

- 双实例共享 body——页签/搜索改动天然两入口同得，真机两处都验。
- 定向套件口径同 C17；**排在 C26 之后**（行语义/路由入口基线）。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：搜索纯函数（本工作区过滤/大小写/中文路径）、页签可见性纯逻辑（git/非 git）。
3. 真机：①头部只剩路径；②三页签切换，diff 显示真实改动（造一个未提交改动）、git 列出真实提交；③页内搜索命中→预览；④(壳 tab 入口)与(胶囊→查看项目文件入口)两实例行为一致；⑤返回语义不回退。
4. 读图 ≥6 存 `paseo-go/evidence/C27/`。

- 恰好一次 commit；报告 JSON（含 onCommitPress 取舍）。
