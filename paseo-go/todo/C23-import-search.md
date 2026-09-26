# C23 导入屏搜索（query 透传 + 旧 daemon 降级）

## 背景 / 用户拍板

用户：「导入会话没有搜索功能。」取证：daemon RPC 已支持 `query`（protocol messages.ts:1332-1340，provider 侧检索扫描窗 500）；官方桌面 import-session-sheet 已实现（debounce + `useHostFeature(serverId,"importSessionSearch")` capability gate）；壳 `use-import-list.ts` 只传 `{limit}`——纯壳侧漏配。裁定 DESIGN §14.10。

## 设计裁定（照此执行，不得重开）

1. `src/app/(shell)/import.tsx`：顶栏加搜索输入（复用壳既有搜索交互姿势——chats/workspace 的 bar morph 模式；locales 新 key zh/en 对齐，locales.test 会闸）。
2. `src/shell/import/use-import-list.ts`：入参加 `query: string`；非空时透传 `fetchRecentProviderSessions({ limit, query })`（client SDK 已支持——官方 sheet 同款调用）；**requestSeq + stale-host 双守卫保持**，query 变化也进 seq（旧 query 的响应不得覆盖新 query）。
3. capability gate：`useHostFeature(serverId, "importSessionSearch")`——false（旧 daemon）时 query 不进 RPC，改**客户端过滤已载条目**（title/firstPromptPreview/lastPromptPreview/cwd 小写子串，纯函数进 `rows.ts` +test）；空态文案区分"服务端无结果"与"本地过滤无结果"。
4. debounce ~300ms（对齐官方 sheet 姿势）。

## 范围

- 动：`src/app/(shell)/import.tsx`、`src/shell/import/use-import-list.ts`（+test）、`src/shell/import/rows.ts`（+test）、`src/shell/locales/{zh,en}.json`
- 不动：daemon、官方 sheet、导入执行链路

## 工程约束

- 文本注入测试必须 ADBKeyboard（BUILD.md §4，C13-F1 教训）。
- 定向套件口径同 C17。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：use-import-list（query 进 seq/守卫矩阵）、rows 过滤纯函数边界、locales 对齐测试。
3. 真机：导入屏输入 `C13` → 列表即时收窄命中含 C13 条目；清空恢复；导入一条命中项成功。
4. 读图 ≥2 存 `paseo-go/evidence/C23/`（命中态/清空态）。

- 恰好一次 commit；报告 JSON。
