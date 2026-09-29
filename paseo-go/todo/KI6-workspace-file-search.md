# KI-6 文件屏搜索：全仓文件名 + 内容兜底（VSCode 体验，用户拍板 2026-09-29）

## 用户裁定（原话口径）

「加**全仓文件名搜索**，如果搜不到就尝试**搜文件内**，反正我想要 **vscode 的那种搜索体验**。」
= 文件名模糊匹配优先（Ctrl+P 感）；文件名零命中 → 自动降级内容搜索（Ctrl+Shift+F 感）。
背景：v0.2.0 实测搜 `apk` 零命中（现口径=只覆盖本次运行浏览过的目录，C27 裁定 3；
上游无文件名搜索 RPC 的旧裁定被下述事实推翻）。

## 关键事实（编排者已取证，卡内为准）

1. **全仓文件名搜索=官方既有 RPC，零协议改动**：`directory_suggestions_request`
   （`messages.ts:2478`）支持 `cwd`=仓根 + `includeFiles:true` + `matchMode:"fuzzy"` +
   `limit≤100`；server 实现（`session.ts:5033`）`respectGitIgnore=true`、返回相对路径 entries。
2. **内容搜索无 RPC**（UPSTREAM-ISSUES #4659 在案）→ 必须新增，协议纯增 optional（C25 微缝先例）。

## 实现口径

### Tier 1（纯壳侧，先落地即见效）

`src/shell/files/file-search.ts` + `src/shell/components/files-screen-body.tsx` 搜索段：

- 查询提交给 `directory_suggestions_request{cwd: workspaceRoot, query, includeFiles:true,
includeDirectories:false, matchMode:"fuzzy", limit:100}`（走 host runtime client，同
  file_explorer 用法）；结果行=文件名 + 相对路径副行；点击→现有预览链路（shellPreviewHref）。
- 现「浏览目录」本地索引降级为 **RPC 失败/旧 daemon 的兜底**（错误态文案说明口径切换）。
- 空态文案改写（旧文案宣称"只覆盖浏览过的目录"，已不再是主口径）。

### Tier 2（内容搜索兜底，协议+server 微缝）

- **协议**（`packages/protocol/src/messages.ts` 纯增 + COMPAT 注释 + `generate:validators`）：
  `workspace.content_search.request {cwd, query, limit≤60, requestId}` →
  `workspace.content_search.response {matches:[{path, line, preview}], truncated, elapsedMs, requestId}`。
- **server**：新模块（建议 `server/src/server/workspace/content-search.ts`）：gitignore 感知的
  文件遍历 + 子串匹配；护栏=单文件 ≤1MB、跳过二进制（NUL 探测）、总扫描字节预算 + 超时截断
  （`truncated=true` 如实报）；先看 server 依赖树里有无现成 ripgrep（有则 spawn rg 更快，无则
  Node 遍历，**不新增依赖**）。`session.ts` dispatch +case 一行；
  `authorization/operation-permissions.ts` +两行（`workspace.read`）。
- **壳**：Tier 1 文件名零命中 → 自动发内容搜索，结果区标题「文件内容 · N」；命中行点击→预览
  定位到行（预览若不支持行定位则只打开文件，记 known_issue）。
- **能力闸（KI-6S 已定契约，照此实现勿另造）**：server 未加 server_info.features 旗标；
  壳侧把 `rpc_error{requestType:"workspace.content_search.request"}`（handler_error/校验失败）
  视为"主机无内容搜索"→ 静默只跑 Tier-1，不重复骚扰、不弹错。
  响应无 error 字段；cwd 不存在=rpc_error；空 query=零命中 truncated=false；
  truncated=true 涵盖 limit/64MB 预算/5s 超时/深度>12 任一早停；matches.path=相对 cwd 正斜杠，
  preview≤120 字符。详见 `agent://KI6SServer` api_shape 节。

## 验收（证据契约四项）

1. app+protocol+server typecheck/lint 零错误；`npm run build:server` 绿。
2. 定向：file-search 结果映射单测 + server content-search 单测（fixture 树：命中/二进制跳过/
   大小闸/截断）；app 套件失败集=W1 基线零新增；protocol 套件全绿。
3. 真机（MatePad，IdleGame 仓）：搜 `apk` → **文件名层就有命中**（全仓口径）；搜一个只存在于
   文件内的词 → 文件名零命中自动出内容命中；点击进预览。
4. 读图 ≥3 存 `paseo-go/evidence/KI6/`。

## 上游触点申报（DESIGN §13 增补裁定 7 覆盖）

messages.ts（纯增）、session.ts（+case）、operation-permissions.ts（+2 行）、
content-search.ts（新文件）。Tier 1 零触点。

恰好一次 commit；报告 JSON。文件域与 KI-7 相交（files-screen-body/locales/messages.ts）→ 串行。
