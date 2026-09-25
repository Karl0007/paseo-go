# R1 host-runtime 陈旧 connecting 态排查（C2 known_issue 立案，P0 插队）

## 背景 / 用户拍板

C2 真机验收发现：metro 重启 + daemon 重启后，平板上 host-runtime store 全局 version 冻结（~8）、controller snapshot 卡 `connecting`，但 WS 心跳/推送仍在 → 官方 `useHostRuntimeConnectionStatuses` 返回陈旧 connecting，在线 host 被归入离线组。`pm clear` + 全新 welcome 直连仍复现；官方 UI（壳模式关）同样表现 → 疑官方 runtime dev 重载路径缺陷。C2 报告含同 render 三路实证（map=connecting / direct=online / live=connecting）。此故障阻塞 C3+ 所有真机验证的可信度，先立卡查清。

## 设计裁定（照此执行，不得重开）

- 只诊断+缓解，**不改 `packages/**` 上游文件\*\*（铁律不破）
- 产出三选一（按根因）：
  a) **dev-loop 环境性**（metro 重载/daemon 重启的组合触发）→ BUILD.md 增补"重启纪律"章节（谁重启、什么顺序、app 要不要 force-stop），R1 即关
  b) **产品性但仅 dev 构建**（dev launcher 双 reload 路径）→ 同上 + 在 R1 卡尾写一份可提上游的 minimal repro
  c) **产品性影响 release**（daemon 重启后状态永久陈旧）→ 壳侧缓解：`src/shell/` 加 watchdog（WS 心跳活但 connectionStatus 陈旧 >N 秒 → 触发官方 reconnect API），并出上游 repro
- 根因必须落到代码行级证据（文件:行 + 因果链），禁止"重启大法好"式结论

## 范围

- 动：诊断脚本（/tmp）、`paseo-go/BUILD.md`（重启纪律节）、（若走 c）`src/shell/**` watchdog + 单测
- 不动：官方源文件、两缝隙

## 工程约束

- 环境已就位：devd(hub,6767)、metro(hub,8081，确认带 PASEO_GO=1)、平板 adb（BUILD.md §0）
- 复现配方从 C2 报告抄：起 daemon → app 连上 → **重启 daemon** → 观察状态是否冻结；再叠 metro 重启变体
- 取证手段：logcat、app 内 debug 探针（壳屏临时打印三路状态，验证后移除或留壳设置"诊断"页）、`/api/health`

## 验收（四项证据契约按卡裁剪）

1. 静态门禁（若改壳代码）：typecheck+lint+oxfmt
2. 套件：derive 等既有单测 +（若 c）watchdog 单测；stash 对照无新增失败
3. 真实运行：按配方复现 → 应用缓解 → 同配方下状态正确刷新，前后截图对比
4. 读图：≥2 张（复现态/缓解后）

- 恰好一次 commit；报告含根因链（文件:行）与 a/b/c 归类；known_issues 里给 C3 的验证注意事项

## 结论（R1 完成，归类 c：产品性、影响 release）

- 根因（文件:行级）：`packages/app/src/runtime/host-runtime.ts:2505-2524` 聚合 hook 用 `void version;`（L2517）声明重算依赖；`packages/app/app.config.js:191` `reactCompiler: true` 使 babel-plugin-react-compiler 重推 memo 依赖并忽略手写 deps → 编译产物只在 `serverIds` 身份变化时重算 Map（`if ($[5] !== serverIds)`，version 不在条件内）→ host 列表最后变化时刻 controller 若还在 booting（快照默认 connecting，L409-417），Map 永久冻结；transport/WS/store 全部正常（直读 `getSnapshot()`=online、per-host hook=online）。与 daemon/metro 重启无因果——重启只是让"冻结瞬间"被注意到的舞台；`pm clear` 后全新直连同样复现（连接时 upsert→serverIds 定格于 connecting 窗口）。C2 三路实证逐条对上。详见 `paseo-go/R1-upstream-repro.md`。
- 缓解（壳侧，已验证）：`packages/app/src/shell/runtime/use-shell-host-statuses.ts`（version 作真实操作数，编译产物条件含 `$[n] !== version`）+ chats.tsx 切换；单测 3 例（含编译契约测试）。真机：重启 daemon 后 UI 逐拍跟随 error→connecting→error→online（旧包同配方永久卡 connecting）。
- 卡内"watchdog"处方按证据修正：快照本身不陈旧，陈旧在 UI memo——重连 watchdog 治不了且会 churn 健康连接，故未做。
- 给 C3 的验证注意事项（known_issues）：
  1. 壳屏一律用 `useShellHostStatuses`，禁用官方 `useHostRuntimeConnectionStatuses`（add-project-flow.tsx:321、use-schedules.ts:44、new-workspace-screen.tsx:1337 三个官方调用点在上游修复前仍可能显示陈旧聚合状态，别当回归报）。
  2. 真机验证前确认 metro 带 `EXPO_PUBLIC_PASEO_GO_SHELL=1`（卡内写的 `PASEO_GO=1` 是笔误，SPIKE.md 为准）；重启 metro 后需 force-stop+重启 app 才会拉新 bundle（`r` 键经 hub stdin 不可靠）。
  3. 壳 APK 与官方 debug APK 共用 6767 时，daemon 日志 `hello resumed` 属正常（同 clientId 会话续接），不是故障信号。
  4. 取证利器：metro inspector CDP（`/json/list` → `Runtime.evaluate`）可直读 app 内 store/React fiber，比 logcat 快（dev 构建 console 不进 logcat，进 metro 日志）。
