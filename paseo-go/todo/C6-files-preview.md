# C6 文件浏览 + 预览栈 + 文件动作 + 文件收藏

## 背景 / 用户拍板

DESIGN.md §5 文件部分。基线 = C5 HEAD；C1 spike A3 结论决定实现路径（覆盖回调 or 自绘轻量树）。

## 设计裁定（照此执行，不得重开）

- 文件浏览屏 `(shell)/files/[serverId]/[workspaceId]`：优先嵌官方 `FileExplorerPane`，打开回调覆盖为 Stack push 预览（A3 失败则自绘轻量树：目录树+git 状态徽标+面包屑，允许 +2-3 天）
- 预览屏 `(shell)/preview?...` 按类型分派：图片（缩放/双指）｜视频（原生播放器）｜代码/文本（语法高亮只读，官方编辑器组件若可复用则复用）｜markdown（官方渲染器）｜html（webview）｜其他二进制（信息卡：大小/类型/修改时间 + **下载/分享**大按钮，走官方 download-store/useFileDownload）
- 文件长按菜单：收藏｜下载｜分享｜复制路径｜添加到对话（composer 附件——若官方 composer 无编程附件接口，此项记 known_issue 排 P1）
- 收藏：`favorites` store（hostId+path+name+size+mtime）；工作区 tab 收藏夹区渲染文件项：点击→预览；长按→取消收藏/分享/复制路径；收藏成功触觉+toast
- 大文件预览保护：>5MB 文本不渲染全文（头部预览+提示），图片>2000px 降采样（官方图片管线若有则复用）

## 范围

- 动：`src/app/(shell)/files/**`、`src/app/(shell)/preview.tsx`、`src/shell/stores/favorites.ts`、`src/shell/components/**`、locales
- 不动：官方源文件（import 复用）

## 工程约束

- 文件读取一律走官方 client 的 readFile RPC / download 端点，禁止新造传输通道

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿（favorites 去重/持久化、类型分派函数单测：apk/png/md/ts/html/大文件边界）
3. 真实运行：真实 daemon 上：浏览→点图片缩放→点视频播放→点 apk 出信息卡→下载分享面板弹出→长按收藏→工作区收藏夹出现该项→杀 app 重启仍在
4. 读图：≥5 张（文件树、图片预览、apk 信息卡、分享面板、收藏夹区）

- 恰好一次 commit
