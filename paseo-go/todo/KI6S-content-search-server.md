# KI-6S 内容搜索协议+server 层（KI-6 拆单前置，无设备）

父卡 `KI6-workspace-file-search.md` 的 Tier-2 服务层切片；壳 UI 层留父卡（设备道恢复后）。

## Change

1. **协议**（`packages/protocol/src/messages.ts` 纯增 + COMPAT 注释，跑 `generate:validators`）：
   `workspace.content_search.request {cwd, query, limit≤60, requestId}` →
   `workspace.content_search.response {matches:[{path, line, preview}], truncated, elapsedMs, requestId}`
   （+inbound/outbound union 注册，照 checkout.diff.get 的命名/形状惯例）。
2. **server**：新模块 `server/src/server/workspace/content-search.ts`：gitignore 感知遍历
   （复用仓内现成 ignore 设施——先找 directory-suggestions/checkout 用的那套，勿引新依赖）；
   子串匹配（大小写不敏感）；护栏：单文件≤1MB、NUL 探测跳二进制、总扫描字节预算
   （常量+注释）、超时截断 `truncated=true`；命中行 preview≤120 字符。
   `session.ts` dispatch +case；`operation-permissions.ts` +request/response 两行（workspace.read）。
3. **测试**：content-search 单测（fixture 树：命中/大小写/二进制跳过/大小闸/预算截断/gitignore）
   - protocol messages 解析用例（req/resp 往返）。

## 门禁（本卡无设备项）

`npm run build:server` + protocol/server/app typecheck + oxlint 零错；protocol 套件全绿；
server 定向+全量失败集=基线零新增；app 套件不跑（零 app 文件改动，报告注明）。
恰好一次 commit（`feat(paseo-go): KI-6S ...`）；报告 JSON（gates+known_issues）。
