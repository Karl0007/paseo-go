# KI-7 git 记录段：全量历史 + 分支/远端关系（VSCode 语义，用户拍板 2026-09-29）

## 用户裁定（原话口径）

「git 记录也是，**全量显示**，同时**显示分支和远端关系**，你应该知道 vscode 里面的 git 记录长啥样。」
背景：v0.2.0 实测 IdleGame 仓 git 记录段=「提交 0 / 尚无领先于 base 的提交」，而 `git log` 有完整历史。

## 关键事实（编排者已取证，卡内为准）

1. 现 git 记录段=官方 `CommitsSection`，语义=**ahead-of-base**（`use-commits-query.ts` /
   `checkout.commits.list`，i18n `noneAhead`）——不是全史。官方 body 上游文件，壳改不动语义。
2. **分支/远端关系字段已在 `checkout_status`**：`currentBranch / upstreamRef /
aheadOfOrigin / behindOfOrigin / hasRemote`（messages.ts:5190-5235）——文件屏已消费该查询
   （isGit 闸），零新 RPC。
3. **全量历史无 RPC** → 协议纯增（C25 微缝先例，DESIGN §13 增补裁定 7 覆盖）。

## VSCode 对标口径（裁定转译，防跑偏）

= 内置 Commits 视图的信息模型，**不是** Git Graph 的 DAG 画布：
每条提交带 ref 徽标（`HEAD → main`、`origin/main`），顶部一行同步态
（`main ⇅ origin/main ↑2 ↓1`，无远端时只显分支名）；列表=HEAD 全史分页。

## 实现口径

### 协议（messages.ts 纯增 + COMPAT + generate:validators）

`checkout.history.list.request {cwd, limit≤200, skip, requestId}` →
`response {entries:[{sha, shortSha, subject, authorName, dateISO,
refs:[{name, kind:"head"|"local"|"remote"}]}], currentBranch, upstreamRef,
aheadOfOrigin, behindOfOrigin, hasRemote, requestId}`。

### server

新模块（建议 `server/src/server/workspace/commit-history.ts`）：`git log HEAD` 带
`--pretty=format` 定制字段 + `--decorate=full --no-color`，解析 refs 徽标（head/local/remote
分类）；`skip/limit` 分页；非 git 仓→`{entries:[], isGit:false}`。`session.ts` +case 一行、
`operation-permissions.ts` +2 行（workspace.read）。**不新增依赖。**

### 壳（git 记录段整体换血）

- 摘掉 `CommitsSection` 嵌入（files-screen-body.tsx 的 git 段），换壳侧新组件
  `src/shell/files/commit-history-list.tsx`：顶部同步态头行（checkout_status 现成字段）+
  全史列表（subject 主行；`短sha · 作者 · 时间` meta；refs 徽标 chip：HEAD→分支 accent 色、
  远端 muted 色，token 化）；滚动到底 next page（skip 分页）。
- 旧「领先 base」语义不再单列（origin/main 徽标落在分叉提交上=同一信息，VSCode 姿势）。
- 点击行为=与现状同深度（不接 diff 面板；官方行本就未接线）；要做属后续卡，记 known_issue。
- 能力闸：旧 daemon 无 history RPC → git 段回退现 CommitsSection（保留旧嵌入代码路径由闸切换）。

## 验收（证据契约四项）

1. protocol/server/app typecheck+lint 零错误；`npm run build:server` 绿。
2. 定向：commit-history 解析单测（decorate 样本：HEAD→main, origin/main, tag）+ 分页 +
   非 git 仓；protocol 套件全绿；app 套件失败集=W1 基线零新增。
3. 真机（MatePad）：IdleGame 仓 git 记录段=**完整提交列表**（含 2186ecb 等真实提交）、
   头行显 `main`+远端同步态、HEAD/origin 徽标可见；非 git 目录段灰闸回归。
4. 读图 ≥3 存 `paseo-go/evidence/KI7/`。

## 上游触点申报（DESIGN §13 增补裁定 7 覆盖）

messages.ts（纯增）、session.ts（+case）、operation-permissions.ts（+2 行）、
commit-history.ts（新文件）。

恰好一次 commit；报告 JSON。文件域与 KI-6 相交（files-screen-body/locales/messages.ts）→
**排 KI-6 之后串行**。
