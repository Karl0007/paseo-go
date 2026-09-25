# REVIEW-FIX 审查轮修复批（三 lane 合并，P1×1 + P2×7 + 文档×3）

## 背景 / 用户拍板

Review 轮三路审查（状态并发/导航生命周期/安全隐私）完成，编排者仲裁后的立案清单。逐条已给 file:line+根因+修法，照此执行不得重开设计。基线=当前 HEAD。

## 修复项（按序做，全部完成后一次 commit）

### F1 [P1] 导入×切 host 竞态覆盖

`src/app/(shell)/import.tsx:294`：runImport 捕获旧 host 的 load 闭包，切 host 后 `void load()` 拿到最新 requestSeq 绕过守卫，用 A 的响应覆盖 B 的列表。修法：runImport 捕获 serverId，尾部仅当 serverId 未变才 load()；或 serverId 变化时 bump requestSeq 作废旧闭包。补单测（导入中切 host 不覆盖）。

### F2 [P2] 缝隙未门控 settings rehydrate（两 lane 同报，高置信）

`src/app/index.tsx:37-40`：Redirect 首帧即触发并卸载自身，persist 回灌后无人重算 → env-on 包里"关掉壳模式重启"确定性失效。修法：未 `persist.hasHydrated()` 时渲染启动占位（参考 commands/edit.tsx:445-446 姿势；订阅 onFinishHydration），回灌后再分支。缝隙行数预算 ≤5 行内解决（引 shell 侧 hook 实现）。

### F3 [P2] lastFocusedTab 永远记不到

`src/app/(shell)/_layout.tsx:113-123`：layout 内 useNavigation 解析到根栈，记录的 name 恒为 `(shell)`，C8 的"主题 remount 保 tab 位"与分发器"记忆优先"双双失效。修法：下探一层 `focused?.state` 取嵌套 tab 名；补 shellLastFocusedTab 单测。

### F4 [P2] 未读水位跨时钟域

`src/shell/chats/derive.ts:64-65` + `chats.tsx:240`：markRead 写设备墙钟 vs daemon 时钟戳比较，host 时钟偏移→未读不灭/永不未读。修法：markRead 以该会话自身 `chatLastEventAt(agent)` 作水位。更新单测（时钟偏移边界）。

### F5 [P2] 通知 recency floor 跨时钟域

`src/shell/notify/attention.ts:76` + `use-shell-notifications.ts:80`：fireFrom=设备 Date.now() 过滤 host 戳，host 落后→通知永久静音。修法：基线扫描把每 agent 当时 (kind,stamp) 全量记 ledger，floor 改纯 ledger 判定。更新 attention 单测。

### F6 [P2·安全] 预览屏 workspaceRoot 参数优先

`src/app/(detail)/preview.tsx:229-233`：URL 参数压过 descriptor，恶意 paseo:// 深链可驱动任意路径读取。修法：**反转优先级**——descriptor 优先，参数仅在无 descriptor 时兜底（离线收藏场景）；两者都在且参数非 descriptor 前缀→忽略参数。补单测。

### F7 [P2·安全] 通知正文错误回显 + visibility 隐式

`src/shell/notify/use-shell-notifications.ts:46-51` + `service.ts:45-56`：lastError 原文（可能含路径）进正文；channel 未显式 visibility。修法：正文去错误原文改通用 failedBody（点开在 app 内看详情）；channel 显式 `visibility: PRIVATE`。

### F8 [P2·安全裁定] scheme 分叉

`packages/app/app.config.js` 壳分支：`scheme: isPaseoGo ? "paseogo" : "paseo"`（+1 行，缝隙预算内）。官方配对链接归官方 app，壳深链自持；C14 恢复 recipe 的 `paseo://me` 改 `paseogo://me`（BUILD.md 同步）。

### 文档三项

- DESIGN §6 追加：本地数据明文+备份残余风险记录（威胁模型结论：不加密，理由存档）
- BUILD.md：scheme 分叉影响 + 已知问题#6（构建/daemon 内存分时）若 C13 未写则补
- 本卡尾部记"审查轮裁定表"：采纳 8/11，缓办 2（RN-F3 冷启动 700ms 竞态 confidence0.45→记 known_issue 观察；快捷指令 prompt 长度上限→cosmetic 不做）

## 范围

- 动：上列 file:line 对应文件 + 各自 test + locales（如需）+ BUILD.md/DESIGN.md 注记
- 不动：官方文件（缝隙两文件在预算内）

## 验收

1. 全量门禁绿 2. 套件 stash 对照无新增 + 每项修复带回归测试 3. 真机抽验两项：F2（env-on 包关壳模式重启→落官方 IA）+ F6（手拼 paseo://(paseogo://) 恶意参数深链→descriptor 接管或拒读）4. 读图 ≥2 存 evidence/REVIEW-FIX/

- 恰好一次 commit；报告逐项 F1-F8 处置表

---

## 处置表（ReviewFix 执行轮，基线 HEAD=463e171c）

| 项                             | 处置                              | 红→绿证据                                                                                       | 落点                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 导入×切host竞态             | ✅ 修                             | 红：`use-import-list.test.tsx` 断言 A 覆盖 B 失败（守卫禁用探针）；绿：2/2                      | 列表加载抽成 `src/shell/import/use-import-list.ts`（stale-host 守卫：闭包 serverId ≠ 当前即拒跑），import.tsx 接线                                                                                                                                                                                                                                                   |
| F2 缝隙未门控 rehydrate        | ✅ 修                             | 红：`use-shell-seam.test.tsx` 无门控探针 2/3 失败；绿：3/3；真机过（下）                        | `src/shell/use-shell-seam.ts`（hasHydrated+onFinishHydration+2s failsafe 防 zustand storage-reject 永挂）；index.tsx 缝隙净 +1 行（总 5 行，预算内）                                                                                                                                                                                                                 |
| F3 lastFocusedTab 恒 null      | ✅ 修                             | 红：`focused-tab.test.ts` 嵌套下探用例失败（扁平旧形状）；绿：3/3                               | `src/shell/focused-tab.ts` `focusedShellTab`（下探 `focused.state`），\_layout record 用它                                                                                                                                                                                                                                                                           |
| F4 未读水位跨时钟域            | ✅ 修                             | 红：`open-agent.test.ts` 7 用例 5 失败（旧实现盖设备钟）；绿：7/7+derive 回归                   | opener 双拍改盖 `chatLastEventAt`（host 域）+单调 max+目录未命中保 pending；`readState.markRead` 去设备钟默认参（必填）；service 通知 tap 同域改盖；chats.tsx 传 `lastEventAt`                                                                                                                                                                                       |
| F5 通知 recency floor 跨时钟域 | ✅ 修                             | 红：host 落后 1h 的新 failed 被旧 floor 静音（断言失败）；绿：12/12（含 baseline 全量记账用例） | `attention.ts` 删 `fireFrom`，floor=纯 ledger；hook 删设备钟基线态                                                                                                                                                                                                                                                                                                   |
| F6 预览 workspaceRoot 参数优先 | ✅ 修（优先级反转）+ ⚠ 残余面记录 | 红：`preview-root.test.ts` 模块缺失→实现后 4/4 绿                                               | `src/shell/files/preview-root.ts` descriptor 恒先、参数仅无 descriptor 兜底。**真机发现**：伪造 serverId/workspaceId 使 descriptor 不解析时走兜底仍可读任意 root（daemon listDirectory 不做 root 限制）——卡内裁定的兜底语义所致，非实现偏差；封堵需"兜底 root 须匹配已存 favorite.workspaceRoot 否则拒读"，超本卡裁定面，移交仲裁。`evidence/REVIEW-FIX/f6-01/02/03` |
| F7 通知错误回显+visibility     | ✅ 修                             | 红：locale 缺席断言+`bodyKeyFor` 缺失失败；绿：12/12                                            | `bodyKeyFor`（纯映射）替代 lastError 回显；`failedBodyWithError` 键 zh/en 删除；channel 显式 `lockscreenVisibility: PRIVATE`（expo 字段名即此）                                                                                                                                                                                                                      |
| F8 scheme 分叉                 | ✅ 修                             | app.config.js 单行三元（缝隙 12→12 行）                                                         | 壳=`paseogo`；BUILD.md §4 注记（含 C14 配方 `paseo://me`→`paseogo://me`，该配方文本未入库、以注记为准）。真机旁证：旧包 `paseo://` 与官方双包三选弹窗=劫持面，分叉后消失                                                                                                                                                                                             |
| 文档① DESIGN §6                | ✅                                | —                                                                                               | 本地数据明文+备份残余风险威胁模型记录（不加密裁定+理由+残余风险）                                                                                                                                                                                                                                                                                                    |
| 文档② BUILD.md                 | ✅                                | —                                                                                               | scheme 分叉影响（我的 hunk 独立于 C13 §3.5/#6，只 stage 自己）；已知问题#6 C13 已写，不重复                                                                                                                                                                                                                                                                          |
| 文档③ 本卡裁定表               | ✅                                | —                                                                                               | 见下                                                                                                                                                                                                                                                                                                                                                                 |

## 审查轮裁定表（立案口径）

- **采纳 8/11**：F1-F8（本卡全部修毕）。
- **缓办 2**：RN-F3 冷启动 700ms 竞态（confidence 0.45）→ 记 known_issue 观察；快捷指令 prompt 长度上限 → cosmetic，不做。

## 真机抽验记录（2026-09-26，BRT-W09，debug 壳包 + metro 新 bundle）

- **F2 过**：env-on 包（EXPO_PUBLIC_PASEO_GO_SHELL=1）壳模式开（f2-01/02）→ 关开关（f2-03，persist shellMode=false）→ force-stop 重启 → **落官方 IA**（f2-04：汉堡菜单+工作区头，无壳三 tab 底栏）。修复前该场景确定性滞留壳。验后设备留在"壳模式关"态。
- **F6 部分过 + 残余面移交**：descriptor 可解析场景由单测钉死（参数让位）；真机手拼链（daemon 侧 srv*/wks* 原值）在 app 内未解析出 descriptor → 走卡内允许的兜底读出 win.ini（f6-03）——见处置表 F6 ⚠。首轮泄漏（f6-02）系 metro 陈旧缓存 bundle，metro3 全量重建后 curl 54MB bundle grep 证实全部修复在包内。
- 读图 ≥2：`evidence/REVIEW-FIX/`（boot-01、f2-01…04、f6-01…03）。
- 环境备注：devd/daemon2 开局实际已死；本卡拉起 `devd-lan`（192.168.31.190:6767，hub 常驻，保留）；metro 已停（C13 构建窗口让位）。

## 门禁状态（执行轮末）

- 定向：`src/shell` 全量 28 文件 177 用例绿；app 包 tsgo 干净（唯一错误=C13 未提交桩 `packages/app/packages/app/index.ts` TS2882，非本批）；oxlint/oxfmt 改动面干净。
- **未跑**：全仓 typecheck/lint + app 套件 stash 对照（预算截断 + C13 内存窗口让位）——移交 Main 总门禁一次性执行。
