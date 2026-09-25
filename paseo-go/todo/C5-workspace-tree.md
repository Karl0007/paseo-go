# C5 工作区 tab：主机→项目树 + 官方流程复用

## 背景 / 用户拍板

DESIGN.md §5 主机/项目层级。基线 = C4 HEAD。

## 设计裁定（照此执行，不得重开）

- 结构：搜索框（本卡占位）→ 收藏夹区（本卡空态占位，C6/C7 填充）→ 主机分组（连接点+名称+⚙=push 官方 host settings）→ 项目行（workspace 名+活跃 agent 数角标+图标）→ ＋新建项目 → ＋连接新主机
- 新建项目/连接主机/host settings：全部 push 官方现成路由/流程，零复制粘贴实现
- 项目行点击 → push `(shell)/files/[serverId]/[workspaceId]`（C6 实装，本卡先占位屏显示 workspace 根路径）
- 主机离线：分组头置灰+重试；项目列表按最近使用排序
- 下拉刷新、骨架屏、空态（无主机→引导连接）

## 范围

- 动：`src/app/(shell)/workspace.tsx`、`src/shell/components/**`、locales
- 不动：官方源文件

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿（排序/角标计数纯逻辑单测）
3. 真实运行：双主机树正确；点⚙进官方 host settings 可返回；新建项目走官方流程后树即时出现；连接新主机流程可完成
4. 读图：≥3 张（双主机树、host settings 页、空态/离线态）

- 恰好一次 commit
