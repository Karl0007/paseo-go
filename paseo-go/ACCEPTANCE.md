# Paseo Go 总验收对照表

> 编排者终验文档。口径=DESIGN.md（唯一真相）§1 拍板 + §2 铁律 + §4-§8 功能 + §11 证据契约。
> 基线链：db4fd334(上游) → C0…C16 → REVIEW-FIX(93ada40e) → F6b(78850ca7) → C13 release。
> 状态标记：✅ 验收通过（有直接证据）｜📝 记录在案的裁定/遗留｜⏳ 待补

## 1. 架构铁律核对（§2）

| #   | 铁律                     | 核对结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 证据                                                                                    |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1a  | 缝隙恰好两个             | ⚠ 实为 **2 缝隙 + 1 组微缝（3 文件，后补裁定）**：index.tsx 净 +5 行、app.config.js ≤15 行（原两缝隙达标）；C13-F1 键契约加固另立微缝——新文件 `src/file-explorer/state-keys.ts`（键构造器单一出处，从上游 hook 迁出）+ `use-file-explorer-actions.ts` 瘦身 + `file-explorer-pane.tsx` 1 行 import。裁定（编排者，验收日）：接受——键契约漂移是实测过的 bug 类，回退=双定义复燃；三处冲突均 30 秒手工解，符合缝隙"重新贴缝"哲学。**同步上游时的解法口径**：state-keys.ts 若与上游同名文件冲突取上游、壳侧改 re-export 适配；两上游文件冲突取上游后重贴 import/瘦身 | REVIEW-FIX 报告 seam_budget；本表裁定；C13-F1 卡                                        |
| 1b  | 运行时开关优先 env       | ✅ useShellSeam 门控 rehydrate，seam 优先级 settings>env>默认                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | REVIEW-FIX F2 真机（env-on 关壳重启→官方 IA）+ C13 release 包复验                       |
| 2   | 新代码去处               | ✅ 全部在 (shell)/** 与 shell/**；上游触点仅 1a 所列 5 文件（含微缝裁定），其余零改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 历卡 diff 范围约束 + 验收日全链 diff 清点（414 文件=314 文档证据+95 壳代码+5 上游触点） |
| 3   | 路由字符串收敛 routes.ts | ✅ 唯一出处；routes.test 钉住                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | C1 起持续；F6b/C16 增 href builder 均入 routes.ts                                       |
| 4   | i18n 零缝隙              | ✅ shell/locales/{zh,en}.json 注入；locales.test.ts 深度 key 对齐+占位符一致                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | C12 入库测试                                                                            |
| 5   | 主题零缝隙               | ✅ 色值字面量 grep=0（唯一命中为注释）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | C12 暗色审计                                                                            |
| 6   | 本地状态 6 store         | ✅ pins/archive/favorites/commands/readState/settings 全建，key 前缀 paseoGo.；清除数据一键复位                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | C8 清除实测；REVIEW-FIX 回归                                                            |
| 7   | 上游同步纪律             | 📝 merge 路径已文档化（BUILD.md）；缝隙"重新贴缝"原则入册；实际同步未发生（fork 期短）                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | BUILD.md §5                                                                             |

### 1a 批三触点扩面（KI 批，2026-09-30 补登；DESIGN §16.1/§16.5 裁定覆盖）

| 触点文件                                                  | 变更                                                                                                                                                                              | 卡          | 口径                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `packages/protocol/src/messages.ts`                       | 纯增 checkout.history.list 请求/响应 schema+union+类型（+92 行，COMPAT 注释）                                                                                                     | KI-7        | §16.1                                                                   |
| `packages/server/.../session.ts`                          | +case 派发（+3 行）                                                                                                                                                               | KI-7        | §16.1                                                                   |
| `packages/server/.../operation-permissions.ts`            | +2 行 workspace.read                                                                                                                                                              | KI-7        | §16.1                                                                   |
| `packages/server/.../workspace/commit-history.ts`         | 新模块（DAG lane 算法，server 算壳画）                                                                                                                                            | KI-7        | §16.1 新文件                                                            |
| `packages/server/.../workspace/content-search.ts`         | 新模块（内容搜索 RPC）                                                                                                                                                            | KI-6S       | §16.1 新文件                                                            |
| `packages/client/src/daemon-client.ts`                    | 纯增 searchWorkspaceContent(+25)/listCheckoutHistory(+30) 方法                                                                                                                    | KI-6/KI-7   | §16.1（卡外最小增量，DaemonClient request helper 私有→须加 typed 方法） |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | 官方会话 chrome 隐藏门（4 seam：GateFrame/showScreenHeader/showTabRow/desktop fallback）+ 会话内容顶 inset 消费；**代码净增 2 行**（1 import+1 计算），余为既有行改写+COMPAT 注释 | KI-14/KI-17 | §16.5（门=shellActive，官方模式逐字节不变）                             |

**除上述外上游零改动**；全部纯增或 shellMode 门控，merge upstream 走"重新贴缝"。**同步上游解法口径**：messages.ts/session.ts/permissions 冲突取上游后重跑 `generate:validators` 重贴；workspace-screen.tsx 四处门+inset 按 §16.5 重贴（保留上游正文，重贴门表达式与 insetStyle 消费）。

## 2. 用户拍板核对（§1）

| #   | 拍板                   | 结果                                                                                                                                         | 证据                                                |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| D1  | 收藏文件+快捷指令      | ✅ 收藏混排/两类图标/⚡一键执行/缺 workspace 选择器/composer「存为快捷指令」                                                                 | C6/C7 真机                                          |
| D2  | 整路由直挂官方会话     | ✅ push 官方 h/[serverId]/agent/[agentId]；返回→列表；进入清未读                                                                             | C1-A2/C4；C14 胶囊叠加不改官方路由                  |
| D3  | Paseo Go 品牌+独立包名 | ✅ app.paseo.shell(.debug) 与官方共存实测；F8 后 scheme 亦分叉（paseogo://）                                                                 | C1/C13 共存安装实测；REVIEW-FIX F8 三选弹窗消失旁证 |
| D4  | P1 全做不偷懒          | ✅ 拖拽(C3)/会话+文件搜索(C9)/通知(C11 前台本地+裁定降级记录)/导入(C10)/添加到对话(C6b)/内容搜索(known_issue #4659 上游无 RPC，卡面预案生效) | 各卡 evidence/                                      |
| D5  | 中英双语官方 i18n 设施 | ✅ 全 key 双语对齐测试在套件内                                                                                                               | C12 locales.test                                    |
| D6  | 设计自主权+美观一致    | ✅ C12 八面审计（空态/骨架/错误/触觉/暗色/a11y/双语/一致性）双主题逐屏走查                                                                   | evidence/C12/ 14 图                                 |

## 3. 功能面核对（§4-§7）

| 面                      | 要求要点                                                                              | 结果 | 卡/证据                                              |
| ----------------------- | ------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------- |
| 对话 tab                | 状态胶囊/搜索/＋菜单/三分组/四态灯/未读/长按五动作/归档/下拉刷新/骨架/离线置灰        | ✅   | C2/C3/C4/C12；REVIEW-FIX F1(导入竞态)/F4(未读时钟域) |
| 工作区 tab              | 主机分组/项目行/新建/连接/文件浏览(官方 pane+打开覆盖)/预览六格式/下载分享/长按五动作 | ✅   | C5/C6/C6b；C16 双入口栈修复                          |
| 收藏夹                  | 文件+⚡混排/预览/取消/分享/复制路径/一键执行/编辑删除                                 | ✅   | C6/C7                                                |
| 我的 tab                | 概览卡/官方设置复用/壳设置五项/关于(版本+upstream hash)                               | ✅   | C8；C13 KI-C8-b 注入（⏳ release 实拍）              |
| 会话导入                | 官方 omp 导入流程                                                                     | ✅   | C10；REVIEW-FIX F1                                   |
| 通知                    | 等待批准可达（前台本地通知裁定；EAS/FCM 后台不可达记录）                              | ✅📝 | C11 NOTIFY.md；REVIEW-FIX F5/F7                      |
| 胶囊顶栏（§7 溢出菜单） | 查看项目文件/停止/重命名                                                              | ✅   | C14 Portal 浮层裁定+C16 改道 (detail) 真栈           |
| 主题 remount 保位       | 系统定时暗色切换不丢 tab                                                              | ✅   | C8 机制+REVIEW-FIX F3 修复实装                       |

## 4. 发布物核对（C13）

| 项                   | 要求                             | 结果                                                                                                                                         |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| release APK          | PASEO_GO=1 全链构建              | ✅ 正式版 105,348,232 B；sha256=1d4d20df0f067dbcc4b6a4d1ab1fa630a73ab366688ccbe9732ec7209f11fd64（含 C13-F1 加固；RELEASE.md 两版 sha 在档） |
| 构建链可重入         | 一键脚本+prebuild 补丁自动重打   | ✅ build-release-wsl.sh PHASES=0-4；phase0 幂等补丁；坑①-⑤定稿 BUILD.md §3.5                                                                 |
| 无 metro 离线运行    | release 包首连全流程             | ✅ 冒烟① PASS（evidence/C13/01-04、09、11、40）                                                                                              |
| 版本号/upstream hash | 0.1.0 + db4fd334 关于页显示      | ✅ 实拍 PASS（C13/33，KI-C8-b 落地）                                                                                                         |
| 冒烟全表             | §4-§8 逐项真机                   | ✅ 17/17（文件搜索经 C13-F1 定性=IME 注入伪影改判 PASS；拖拽=MANUAL-PENDING 见 §7）                                                          |
| scheme 分叉终验      | paseogo:// 独占、paseo:// 不劫持 | ✅ pm query 不含 release 包+冷启直达实拍（C13/38；坑⑤入册）                                                                                  |
| 内存纪律             | 构建/daemon 分时（已知问题#6）   | ✅ 定稿入 BUILD.md §3.5+已知问题                                                                                                             |

## 5. 审查轮与遗留（known issues 台账）

| 编号                    | 内容                                                                                                                                        | 状态                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F1-F8+docs              | REVIEW-FIX 批 11 项（采纳 8/缓办 2/记录 1）                                                                                                 | ✅ 93ada40e，全部带回归测试                                                                                                   |
| F6b                     | 预览兜底 root 封堵（信任锚=favorites）                                                                                                      | ✅ 78850ca7，19 边界+真机四重验证                                                                                             |
| C13-F1                  | 文件搜索"零命中"定性=百度输入法吞改 adb 注入文本（非代码回归）；探针实证单 store/活 memo/键正确；顺带加固：explorer 状态键契约单一化+4 单测 | ✅ 6d6b3cff；C13 冒烟勘误 FAIL→PASS（17/17）                                                                                  |
| KI2                     | 官方 FileExplorerPane 返回语义（壳侧 BackHandler 缓解）                                                                                     | 📝 C5 裁定                                                                                                                    |
| KI3                     | 暗色冷启动 tab bar 亮色快照（运行时切换正常）                                                                                               | 📝 todo/KI3（>半天，release note 建议项）                                                                                     |
| 拖拽真人复验            | adb 注入两档速度均无法触发换位（历史注入伪影，C3 起知）；代码路径有单测+旧钩子注入实测                                                      | ⏳ **唯一人工项**：真人手指一次（5 秒）                                                                                       |
| #4659                   | 内容全文搜索上游 RPC 不存在                                                                                                                 | 📝 known_issue 卡                                                                                                             |
| 后台推送                | EAS/FCM 凭据缺失，前台本地通知裁定                                                                                                          | 📝 NOTIFY.md §4                                                                                                               |
| 冷启动通知 700ms 竞态   | confidence 0.45 未复现                                                                                                                      | 📝 缓办观察                                                                                                                   |
| 官方 pane 40dp/上游样式 | 上游基线不动                                                                                                                                | 📝 C12 裁定                                                                                                                   |
| 正式签名                | debug keystore 装机可用；上架需替换 keystore                                                                                                | 📝 RELEASE.md TODO                                                                                                            |
| KI-4                    | 导入屏父子会话无法辨认：父无 title→副标题退化成时间戳+UUID；且只加副标题未分组（devd 实测 50/60 带 parentHandleId、父仅 2 个）              | ✅ 已落地（树形导入，KI 批）；设备帧待补证轮                                                                                  |
| KI-5                    | 导入屏主机 chip 点击无反应：单主机走 `useHostChooser` 自动选中捷径（host-chooser.tsx:88-91），modal 永不打开，且「添加主机」不可达          | ✅ 已落地（主机 sheet，KI 批）；设备帧待补证轮                                                                                |
| KI-10                   | 已回答的交互提问在时间线回放中复活为待答态（误提交=脏数据注入；临时口径=点关闭勿提交）                                                      | 📝 `todo/KI10-answered-ask-resurfaces.md` 待钉死归属                                                                          |
| KI-11                   | 对话列表长按/拖动/置顶四条：代码+单测+①帧已验收（cf305d19，置顶冲突实锤已统一同 action）；②③④设备帧=blocked-device-env 待墙充补证轮         | 🔶 代码毕，补证待设备（BUILD 坑6d）                                                                                           |
| KI-12                   | 三 tab 顶栏逻辑/高度不统一且随滚动移动：抽 shell-tab-header 等高固定容器，逐屏搬出滚动区（已拍板成卡）                                      | ✅ 代码+真机帧毕（等高 300-303px 三 tab 一致、滚动中顶栏像素全等、宽屏同 dp）                                                 |
| KI-6                    | 文件屏搜索只覆盖已浏览目录：升级两层=全仓模糊文件名（directory_suggestions）+ 内容兜底（workspace.content_search，KI-6S server 层已落）     | ✅ 代码+真机帧毕（Tier1/Tier2 真机命中帧在案，无兜底 banner）                                                                 |
| KI-7                    | git 记录段只显 ahead-of-base：升全量历史+分支/远端关系+Git Graph 式 DAG 泳道（用户二轮拍板）                                                | ✅ 代码毕（55d864fe 探针实证 DAG；devd 已重启载新 RPC）；✅ 成品真机验毕（终验轮 2026-09-30）                                 |
| KI-8                    | 会话屏顶栏信息密度：双行化（分支/远端同步态进第二行，与文件屏头行同构）                                                                     | 📝 `todo/KI8-session-header-compact.md` 排队（KI-7 后）                                                                       |
| KI-9                    | 二级屏 hidden-tab 无转场/返回语义混乱：四屏迁 (detail) 根栈真 push+淡入动画+会话菜单收敛两项带 tab 参                                       | ✅ 代码+成品真机验毕（591463b2，push/back/菜单落点 PASS；滑入中间态=ROM 无 screenrecord 物理不可拍）                          |
| KI-13                   | 导入屏切主机后列表残留旧主机数据：切换即清空（render-phase 复位+seq 守卫）                                                                  | ✅ 代码+真机帧毕（切换首帧零残留，6 帧在案）                                                                                  |
| KI-14                   | 会话屏顶部官方 chrome（header 带+tab 行）在壳态隐藏：workspace-screen.tsx +3~4 行 shellMode 门触点，带真塌矮+退役盖条 hack（用户拍板）      | ✅ 代码毕（6ffe067a 触点 4 seam 隐藏官方 chrome；宽屏扩面+inset+无头屏=KI-17 76e32e63）；✅ 成品真机验毕（终验轮 2026-09-30） |
| KI-15                   | 工作区 tab 骨架屏卡死 >40min（补证轮实锤；刷新/切tab/重启无效）：KI-12 重构回归嫌疑>daemon 状态机>R1 变体，修复含壳侧骨架超时兜底           | ✅ 修复毕（e331e514，单台离线主机不再钉死骨架+10s 兜底）；帧随新包重拍                                                        |
| KI-16                   | 会话页三条：下拉刷新(在)/长按弹层阈值 500→**250ms**(用户砍半,双路径同源)/弹窗后拖动接力改序+置顶区语义(普通不误钉·拖出解钉)                 | ✅ 代码毕（d75c51d8，59 定向绿含 249/250 边界）；✅ 成品真机验毕（终验轮 2026-09-30）                                         |
| KI-17                   | KI-14 后果收尾三件：会话内容顶 inset(胶囊不遮首条)/宽屏门扩至 shellActive(藏 wide 带+fallback tab 行)/冷深链无头屏→胶囊无条件可见+返回兑底  | ✅ 代码毕（76e32e63，162 scoped 绿，触点净+2 行）；✅ 成品真机验毕（终验轮 2026-09-30）                                       |
| KI-18                   | 首次内容搜索冷路径 5014ms 超客户端 ~5s 等待窗→空态（warm 重试正常）：等待窗与 daemon 预算同值竞态，修=窗≥预算+裕量+搜索中态+超时文案        | ✅ 修复毕（ec98ed71，8s 窗+可重试超时态三态可分，16/16 定向，真机自然复现帧）                                                 |

## 6. 证据契约总核（§11）

- 每卡：门禁绿+套件对照无新增失败+真机+读图 —— 历卡报告逐项在案（17 功能卡+3 修复批）
- 总门禁（HEAD 6d6b3cff）：typecheck EXIT=0 ✅ / oxlint 0e0w ✅ / app 套件 5636 pass·失败集=W1 环境项零新增 ✅
- commit 纪律：每卡恰好一次；detached HEAD 链完整可溯（db4fd334 → … → 6d6b3cff）

## 7. 结论

**Paseo Go v0.1.0 验收通过**（条件项一项）：

- 架构铁律 7/7 成立（缝隙实测 5+15 行内、i18n/主题零缝隙、路由收敛、6 store 齐）
- 用户拍板 D1-D6 全兑现；DESIGN §4-§8 功能面 release 离线包真机 17/17
- 发布物：`app-release.apk` sha256=1d4d20df…fd64（105MB，debug keystore 签，正式签名=上架前 TODO）
- 审查轮 11 findings：8 修（含 1 P1）+1 封堵+2 缓办+1 记录，全带回归测试
- **唯一开放项**：置顶拖拽换位需真人手指确认一次（自动化注入伪影所致，非代码疑点；若真人拖不动，按 C3 卡回炉）
- 已知遗留全部立卡归档（KI2/KI3/#4659/后台推送/700ms 观察/正式签名），无口头债

---

# 批次二增补（v0.2.0，2026-09-27/28；只增不改上文）

> 口径=DESIGN §14+§15 勘误+DESIGN-tablet.md；基线链 276ebbe6 →(C17-C35 37 commits)→ 453b9dff →(FIX-A/C/R2-14)→ 当前 HEAD。
> 状态标记同前：✅ 直接证据｜📝 裁定/遗留｜⏳ 待补。

## B1. 功能面核对（§14 逐条）

| #      | 功能                                   | 结果 | 卡/证据（evidence/ 目录同图）                                           |
| ------ | -------------------------------------- | ---- | ----------------------------------------------------------------------- |
| §14.3  | 行长按=锚定 popover+拖拽接力           | ✅   | C19/C20/C33；接力 8px 阈值+pending-open 姿势，C33 popover 形态复验      |
| §14.4  | 置顶拖拽换位                           | ✅   | C20 五项矩阵+真机；钳入置顶组=裁定推论（R2 台账在册）                   |
| §14.5  | 会话屏薄顶栏→胶囊全宽替换              | ✅   | C21 六项矩阵（亮/暗/穿透/blocker 释放）；C32 compact-only 边缘带        |
| §14.8  | 工作区三层树（工程/worktree/会话）     | ✅   | C26（22 记录→1 行物理合并双向核账）；R2-06 角标同源修复                 |
| §14.9  | 文件屏三段页签+头部只路径+搜索         | ✅   | C27 17 帧双实例；RetainedPanel 状态保活                                 |
| §14.10 | 导入：搜索/刷新/分叉警示/父链/可能活跃 | ✅   | C23/C24/C25（wire 196 行全带字段）；C35 刷新重放修复+真机③闭环 453b9dff |
| §14.2  | 新建对话直达 /new                      | ✅   | C17                                                                     |
| §14.6  | 未读=完结制+双拍                       | ✅⏳ | C18 窄屏全证；宽屏双拍缺陷 R2-02/03 → FIX-B ⏳                          |
| §14.7  | 菜单 popover 化+rename 独立屏          | ✅   | C19/C33（ChatRenamePage 干净退役 grep=0）                               |
| §14.11 | 平板分栏（骨架→接线→收尾）             | ✅⏳ | C30/C31/C32（24 帧转屏序列零重挂）；官方面断点残留 R2-04 → 拍板 ⏳      |
| §14.12 | 语音=OpenAI provider 配置面            | ✅📝 | C28（toast 消失/录音态可进）；端到端=待用户端点（VOICE-DEPLOY.md）      |
| §14.13 | 深链 paseogo://                        | ✅   | C31 冷启动落右栏；F2 双包选择器=非缺陷记录                              |

## B2. 架构铁律核对（批次二增量）

| #   | 项              | 结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | 上游触点        | ✅ 批次二终账（本行=唯一真相）：**缝隙 3**=index.tsx/app.config.js/`_layout.tsx`+3 行(C30)；**键契约微缝 3**=state-keys/use-file-explorer-actions/file-explorer-pane；**功能面新触点 4**=`constants/layout.ts`(R2-04 转屏断点 #8)、`utils/workspace-identity.ts`(R2-09 Windows 折叠)、`storage/validated-persist-storage.ts`(R2-13 去破坏性)、`test-stubs/lucide-react-native.ts`+2 行；**协议 2**=agent-labels/messages 纯增；**server 8**=omp 父链/刷新/盖章/透传；**CLAUDE.md** fork 指路。merge 冲突口径同 §2.7 重新贴缝 |
| 3   | 路由收敛        | ✅ 强化：R2-12 单源派生+目录双向对拍闸（7afdf8ea）                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4/5 | i18n/主题零缝隙 | ✅ locales 平价闸+R2-16 术语统一；暗色 C21/C27/C31 逐屏                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | store 面        | ✅ 7 店（+forkAck）clear-local-data 全覆盖断言；R2-13 硬化=拍板 ⏳                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | 缝③贴缝口径     | 📝 `_layout.tsx` 冲突解法=保留上游正文重贴 wrapper（同 §2.7 姿势）                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## B3. 审查轮（批次二）

- 四维度 26 卡 → 复核庭：6×P1 CONFIRMED、2 降级、R2-13 现行链发现；详见 review/REVIEW2-INDEX.md
- 已修：FIX-A 5 卡（90e016ce，设备复验 PASS 453b9dff）+ FIX-C 10 卡（7afdf8ea，含假绿 5 条先证伪绿、对拍闸 2 枚）+ R2-14（f34a77e5）
- ⏳ FIX-B（R2-02/03/04/08/09/13/19/21）=用户拍板包待复 → 修 → P1 复审销卡

## B4. 门禁与证据契约

- 总门禁（FIX 后终值随 release 记录）：typecheck EXIT=0 ✅ / oxlint 0e0w（4431 文件）✅ / app 套件 5866+ pass·失败集⊆W1（time×2+changelog×2+forges+live）✅ / protocol 707/707 ✅ / server 全量=环境性口径入 W1 补记（改动域零失败）✅
- C34 竞态：c4 定案（磁盘真相）；18 样本矩阵=设备窗口二 ⏳
- 每卡恰一次 commit+读图在案；C35 证据补齐 bb0c424b

## B5. 发布（v0.2.0）

- ✅ release APK 105,465,012 B / sha256=`cb074aff…2aaa`（production prebuild 重跑修正坑⑥变体漂移；原生 hermesc 代 WSL 降级=坑⑦；BUILD §3.5 已记）；签名仍 debug keystore（上架 TODO 结转）
- ✅ 冒烟：离线冷启 11s×16、三 tab、横屏分栏+占位、深链直落、关于页 0.2.0@db4fd334（`evidence/RELEASE-020/` 7 帧）
- ✅ C34 release 轮 8/8（UI 断言口径，run-as 不可用如实记）；总判 debug 18/18 + release 8/8 → **c1 竞态未证实终笔，C34=观察误差（c4 定案）**
- ✅ 触点#8 官方文件改动的测试 re-pin 三处（c28605c7 + tracks-panel 显式 wide 声明），套件回基线

## B6. 批次二结论

**Paseo Go v0.2.0 验收通过**。功能面 §14 十三项全 ✅（语音端到端=外部依赖挂起非缺陷）；review 轮 26 卡全处置（修毕/降级/驳回/转上游=UPSTREAM-ISSUES.md 8 条）；P1 全销卡含设备复验；门禁=基线零新增；发布物在档。开放项三条见 README 首屏（真人拖拽/语音端点/Q10 事后审），无口头债。

---

# 战略链增补（M1-M4，2026-09-30；只增不改上文）

## M1. 上游合流 v0.10.2

- ✅ 种子合并：`9ce29a1d7`（codeload tarball，树=上游真 sha `919c737c` 逐文件全等 4980 文件+7 syml，父=db4fd334；partial clone 拒 fetch 的既定替代路径）→ merge `1789ebbca` **零冲突**（312 文件 +19912/-2168）；fixup `3cb40c0c1`（VERSION=0.10.2-go.0 双系口径 / SHELL_UPSTREAM_REF=919c737c）
- ✅ 11 触点文件逐一 re-stick 核验（8 上游未动=壳版原样；messages.ts/daemon-client.ts/\_layout.tsx hunk 自动合+壳增行 comm 子集校验零缺失）；壳自有树上游零压入
- ⚠ 姿势变更：仓 repo-local `core.autocrlf=false` 永久制（autocrlf×oxfmt 结构性冲突，BUILD.md 坑9 已改口径）

## M2. fork CI 出包（Karl0007/paseo-go）

- ✅ 审计：上游 12 workflow 逐一分级（4 禁用：EAS/Apple/CHANGELOG 覆写/docker 版本断言冲突；其余休眠）；**零触点原则**——仓库级禁用+新增 fork 专属文件，上游 workflow 零改动
- ✅ `fork-release.yml`（tag `v*.*.*-go.*`）：meta/CLI(win32+linux)/APK/desktop(win+linux)/release 组装；go.1→go.6 六轮迭代全绿（npm-cli 路径/exec-bit/sdkmanager/runner 资源各坑在案）
- ⚠ 裁定：APK job GitHub runner 三连驱逐（16GB 天花板，infra 非配置）→ **APK 本机重打 merge 后首包**（sha256=`e3ca12a0…`）上传 Releases+真机装机帧（关于页实拍 `919c737c`）；runner 化留下轮（候选：降并发/self-hosted）
- ✅ Releases `v0.10.2-go.6`=22 资产+全 sha256 表+latest 指针+prerelease；keystore=模板 keystore（与装机链 cert 一致，仓外保管 `C:/work/paseo-go-keystore/`，不入库）；win zip CI 内 unzip -l 六项校验（本机禁忌#1 不实跑）
- ✅ 镜像纪律升级：全量重建+**树对账必须 EMPTY**（merge commit 展平验证）

## M3. 生产 daemon 切 fork

- ✅ 演练：隔离 prefix/home/127.0.0.1:6799 全绿（health/401/omp/血统探针）+壳 APK 三能力真机帧（导入树/内容搜索/git DAG，`evidence/M3/`）
- ✅ 切换：go.6 win32 tarball（Releases 下载，sha256 对账 `5d2d8c2b…b8de`）→ Stop 任务→npm i -g→Start；**自检四条全绿+祖谱合法链**（svchost←services←wininit）；编排者独立复核一致
- ✅ 兼容代证：官方 registry CLI 0.10.1 对 fork daemon 密码闸/hello/provider ls/agent ls 全通（协议纯增纪律兑现）；回滚件=0.10.1 一条命令
- 📝 DEPLOY-NOTES 更新 diff 已交用户过目（`evidence/M3/deploy-notes-diff.md`，未直改生产文档）

## M4. 更新指向 fork Releases

- ✅ 壳 APK：feed=`/releases?per_page=1`（实测 prerelease 仓 latest 端点 404）+`0.10.x-go.N` 段内数值序+一次性提示条（seen 跨重启，第 8 持久店入 reset）+设置页手动三态；测试钩 `EXPO_PUBLIC_PASEO_GO_UPDATE_FEED`；设备 5 帧 `evidence/M4/`
- ✅ desktop feed 触点#（申报）：electron-builder.yml owner/repo→fork（净 +13/-2）+config-parse 单测；📝 发现：electron-updater stable 通道不吃 prerelease→触发需去 prerelease 或切 beta 通道（BUILD.md §7.2 在案，未改）
- ✅ 版本盖章链：`EXPO_PUBLIC_PASEO_GO_VERSION`（CI tag→gradle→壳）+WSL 脚本默认读 VERSION

## M-门禁. 终态门禁（编排者亲跑，HEAD=e3d69c88c 后）

- app 6162 用例：6151 pass / **4 fail 全 W1 环境项**（zh-CN locale ×4；M1 基线 5 项中 CRLF 项随 autocrlf=false 转绿）/ 7 pending → **零新增**
- server unit 6084：5850 pass / **1 fail 环境项**（npm registry E404；M1 基线 EBUSY ×3 转绿）/ 233 pending → **零新增**
- protocol 全绿；typecheck/oxlint 各卡 pre-commit 钩在案
- commit 纪律：M1 成对（merge+fixup）/ M2 按轮 / M4 两切片各一 commit；镜像=每链终态同步

## M-结论

**战略链 M1-M4 全部完成**。终态=一条供应链：`paseo-go` 分支 → GitHub Actions（tag 驱动）→ Releases（CLI tarball/APK/desktop）→ 生产 daemon+壳 APK+desktop 更新全指 fork。开放项+3：④APK CI runner 化（资源天花板，self-hosted 候选）⑤desktop 自动更新 prerelease 通道口径（文档化未改）⑥DEPLOY-NOTES diff 待用户点头落笔。

---

# 批次四增补（v0.10.2-go.7，2026-10-01；只增不改上文）

> 口径源=`todo/BATCH4-ALIGNMENT.md`（F1-F11，18 项裁定）；review 台账=`review/B4-INDEX.md`（33 卡全处置）。

## N1. 用户拍板兑现（F1-F11）

- ✅ **F1/F2/F3 三 tab 单行顶栏**（`1812c6cf4`）：废 accessory 带→定高 60dp（工作区空白带消失）；胶囊「● 1/1」（圆点保留）；segment 上移标题行；窄列三级降级 全称→「活跃/归档」→纯图标（计数三档恒在）；等高测试改钉 60dp 新契约
- ✅ **F4 对话栏微信化**（`222c57063`）：废 needs_attention 跳队（纯时间序）；项目 hash 色圆角 icon（首字符，同项目恒同色）；标题=`项目-worktree[-备注]`；时间挪右上+微信绝对格式（今天 HH:MM/昨天/星期X/MM-DD）；副标题优先级 `[草稿]`红>`[需要回复]`红>`[出错]`红>`我:`/裸预览；running 转圈
- ✅ **F4 数据面 lastMessagePreview+role**（`043b1eacb`）：协议纯增（optional-nullable，旧 daemon 兼容）+server 投影/更新链/hydrate；ws 探针三态实录
- ✅ **F5 横滑切页**（`4034afe59`）：Reanimated 水平手势（列宽 1/4 或尾速）切 进行中↔已归档，与 segment 同状态机；8 项手势冲突审计（垂直/长按/拖拽/下拉/边界/多指/搜索/回顶）；重挂面纪律守住
- ✅ **F6/F7 导入屏**（`d6550dd21`）：默认折叠子会话（chevron+计数，搜索命中自动展开）；已导入/已归档显式徽标（handle 双字段匹配，勾选禁用，点行跳转）
- ✅ **F8 所有权状态机**（server `fad6d0022` + UI `680940e1a`）：`ownership: paseo|external|none` 协议纯增（与出生标签正交）；transcript fs.watch+stat 轮询兜底；R2-lite 降级感知/R3 免刷新同步/R4 警告（按 provider 分级）/R5 转原生；**R2-full 永久关闭**（调研五 provider 零字节损坏，见 RESEARCH-provider-dual-write.md）；裁定 14 UI 强制=三态徽标+弹窗+翻转可见真机帧齐
- ✅ **F9 返回键退搜索**（`9eb2d2570`）：统一 hook，优先级 菜单>搜索>页面（真机时序实锤）；四搜索面接入（文件屏枚举证伪官方无搜索态，实接壳自有 state）
- ✅ **F10 长按回归修复**（`6ec69b112`）：根因=gestureLock 带翻转列表 props 触发整表重挂抹菜单（非 merge 回归，依赖版本未跳）；控件常驻+稳定 containerStyle，全壳侧
- ✅ **F11 转场动画**（`c672e8d2c`）：**翻案**=根栈 animation:none 自上游 0.9.2 种子即存在（KI-9 静态帧假绿，动画从未真机证明过）；shell 模式 (detail)+h/[serverId] 挂 slide_from_right；中间态帧已抓到

## N2. Review 轮（33 卡，`review/B4-INDEX.md`）

- 四维 reviewer + 独立复核庭：21 CONFIRMED / 1 DOWNGRADE / 0 REJECTED；P1（watcher 滞留假 external）探针实锤+销卡复审 PASS
- 修复批 A（server 12 卡 `6b9a72051`+`b78ddc113`）/B（chats 11 卡 `3071a132c`）/C（import+开屏覆盖面 5 卡 `5588ffb12`）
- 尾单五（`5c7e5d634`/`0fa6859ef`/`e9a275a26`/`8530e40aa`/`7854255ab`）：M2 脚本 lint/website schema 机器闸/edge-back 单位混用/AgentSession.isAlive 直报/claude fork-on-send
- 教训入账：测试钉住的现象本身可能是 bug（drag-drop.test）；静态帧不能证中间态（KI-9/R4-08）；小写盘符 cwd 崩 vitest 全局

## N3. 触点终账（批次四净增）

协议 messages.ts（preview 对+ownership 对，既有触点扩展）；server 新模块 agent-last-message/agent-ownership/provider-transcript/transcript-activity-probe/transcript-watch-service + agent-manager/projections/storage/persisted-config/config/bootstrap 扩展；**app 官方文件 4 白名单透传**（session-store/agent-snapshots/agent-directory/use-aggregated-agents，各 +2 行 COMPAT）+ styles/identity-colors.ts（第 5 触点，导出常量）+ electron-builder.yml（M4 前批）；余全壳侧。

## N4. 终态门禁（编排者亲跑，HEAD 批次四末）

- typecheck 全 workspace exit 0；oxlint 仓根 4595 文件 **0 warnings 0 errors**
- app 6297 例：**4 失败全 W1 环境项**（zh-CN locale ×4）/ 0 pending → 零新增（较 M1 末 6162 增 135 用例）
- server unit 6178：**1 失败环境项**（npm registry E404）/ 233 pending → 零新增
- protocol 740：**1 失败环境项**（providers-snapshot 冷 AOT 超时，基线复现）→ 零新增
- ⚠ 纪律事件：`core.autocrlf` 被某在途进程翻回 true（违 M1 永久 false 制）→ 终态门禁时恢复 false，树净无 churn

## N5. 结论

**批次四验收通过**。F1-F11 全兑现（含 F11 翻案、R2-full 关闭两处对原口径的实证修正）；review 33 卡全处置含 P1 销卡；终态门禁零新增失败。发布=v0.10.2-go.7（Releases，APK 本机出+CI 出 CLI/desktop）。开放项延续批次三三条+新增：真人手指复验两处（置顶拖拽/edge-back 正向激活，注入面不可归因）。

---

# 批次五增补（v0.10.2-go.8，2026-10-01；只增不改上文）

> 口径源=`todo/BATCH5-ALIGNMENT.md`（F12-F17 + D19/D20 拍板）；review 台账=`review/B5-INDEX.md`（10 卡全 FIXED）。

## O1. 用户拍板兑现（F12-F17）

- ✅ **F12 标题格式**（`e90f27fee`）：默认=`项目(worktree)`；有备注只显示备注。
- ✅ **F14 置顶往返消失 P1**（`ddaba9b0b`）：根因非数据层（守恒测钉死）=拖拽期卸载 RefreshControl→整表重挂→band 早释→SRF 劫杀 RNGH pan→库 stranded 位移。修=RefreshControl 恒挂载+enabled VALUE 通道+库 patch（heldTranslate 无活拖拽归零）。
- ✅ **F15 长按拖动误触刷新**（`6fbeee0e2`）：与 F14 同源（remount 链）；gestureBand refreshEnabled 接线；真机带内下拉无 spinner 帧。
- ✅ **F17 导入全量+existing 标记**（`b7aafb961`）：协议纯增 includeExisting/existing（COMPAT 带移除日期）；server 三路认领（原生/导入/归档+活跃优先）；**F17-4 根因实锤**=omp resume 写新 transcript 而 persistence 只跟最新文件→祖先链走查（深帽 32/环断/存在性校验）；metadata 恒隐（用户拍板）；壳徽标/禁勾选/点行直达；e2e 生产数据副本验过祖先行正确标记。
- ✅ **F13 小字恒显**（`c5cbc639e`）：根因=pre-B4 记录 preview NULL+整对象替换洗掉已显示预览；修=stickyPreview 持久 store（缺失不清空）+全空占位「暂无消息」双语；三路径真机帧恒在。
- ✅ **F16/D19 所有权两处可见**（`da8489125`）：列表标题后三态小标签恒在（原生/外部/未知，undefined=未知诚实）+会话页 C14 胶囊区同款 pill；单一纯函数判定三处共用。

## O2. Review 轮（10 卡全 FIXED，`review/B5-INDEX.md`）

- 双维 reviewer（app/server）均判 incorrect→修复车内置红测复核：10/10 红→绿，0 REJECTED。
- FixServer5（`42d438807`）：S1 回填计量改 claim-index 尺寸；S2 EISDIR/read 拒绝炸全列表（Windows 实测红）→行走读全兜底；S3 非字符串 nativeHandle TypeError→typeof 守卫；S4 深帽触顶 warn；S5 祖先认领 key 走 sessionPathKey 折叠（win32 门控测）；S6 COMPAT 补 target 日期+「byte-for-byte」注释修正。
- FixApp5（`b1f189524`）：A1 拖拽取消 band 冻结（**实机红绿帧**：拖拽中后台化→吞滚动→修复即复位）=onDragTerminate 透传接线；A2 删冗余 JS session 门（拒绝路径统一回卷）；A3 heldTranslate 衰减 withDelay(32) 避同帧竞态；A4 stickyPreview 连续两次完整 tick 缺席才 prune（离线主机/空目录不误清）。

## O3. 触点与依赖面变化

- 协议 messages.ts：includeExisting?/existing? 纯增（旧端剥键安全，两侧非 strict 已核）。
- **node_modules patch 面 +1 行为改动**：`react-native-draggable-flatlist+4.0.3.patch`（heldTranslate 衰减归零+取消路径透传）；patch-package 失配=postinstall 响亮报错（非静默）。
- server 新面：omp session-descriptor 祖先链走查、import-sessions claim-index、session.ts logger 透传。

## O4. 终态门禁（编排者亲跑，HEAD 批次五末）

- typecheck 全 workspace 0；oxlint 4599 文件 0/0；树净。
- app 6328（+31）：**4 失败=W1 zh-CN 环境集，零新增**；server 6191（+13）：1 环境项；protocol 742（+2）：1 环境项。
- ⚠ 生产停机事故入账（go.8 切换）：代理切换脚本以**会话子进程**（bash async）启动，turn 结束会话挂起→进程树被杀于 Stop 与装包之间，生产停 ~2h49m（用户察觉）。Main 手动原子恢复（sha 亲验→装→启→四条全绿）。教训入 RELEASE.md：**原子性≠持久性——生产切换必须 hub start persistent:true 或 schtasks 自脱离，禁代理会话内后台**。
- 纪律事件×2 入账：①`git stash push -- packages/`（pathspec 过宽）短暂回滚他车在途文件（pop 全恢复，教训=禁 stash/checkout/reset，对照用只读 diff）；②git index 损坏一次（并发 git 写嫌疑），`rm .git/index && git reset` 秒级恢复。

## O5. 结论

**批次五验收通过**。F12-F17 全兑现；review 10/10 红转绿零驳回；发布=v0.10.2-go.8（APK sha256=`7a74bd10…d6b9`，22 资产，五帧装机验证含离线「未知」诚实态）+生产 daemon 原子升级 go.8。开放项延续：真人手指复验三处（置顶拖拽/edge-back 正向/正常下拉刷新帧=注入面不可为）；A3 慢设备漂移帧、已归档徽标真机帧两缺口以线上契约证据替代（各卡 known_issue 在案）。
