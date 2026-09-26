# C13-F1 文件搜索 release 真机零命中(已定性关闭:输入法注入伪影,非回归)

## 现象(C13 冒烟,release 包 0.1.0 @ 463e171c)

工作区 tab → 搜索 → 先浏览 paseo-go 根目录(确认 BUILD.md、smoke-release.apk 在列)→ 返回 → 搜 `build`(小写,IME 候选栏提交,输入框确认只有 `build`)→ `shell-workspace-search-empty`「没有匹配的文件」。搜 `BUILD` 同样。C9 真机轮此功能有命中(evidence/C9/C9-08-workspace-dualhost-hits.png),**属回归**。

## 已排除(静态全链核对,均一致)

- 状态键:`buildWorkspaceExplorerStateKey` = `workspace:{id}`(use-file-explorer-actions.ts:47-57),workspace.tsx:202 前缀过滤匹配。
- kind 词表:protocol `z.enum(["file","directory"])`(messages.ts:2688/2770),matcher `kind !== "file"` 跳过目录一致。
- 匹配器:`searchFileNames` 小写子串+排名,file-search.test.ts 单测覆盖。
- store:`sessions: Record<string,SessionState>`(session-store.ts:428),`Object.entries` 可用;`setFileExplorer`(:1766-1774)替换 sessions 身份 → memo 依赖 `[searchActive,sessions,...]` 会重算。
- 状态存活:返回后预览页 favorite 仍读到 `explorerState.selectedEntry`(C13 实测收藏成功)→ 浏览态确在 store 中。
- `searching=true` 成立(空态带 icon 行只在 query 非空时渲染)→ query 非空、searchActive=true、searchFileNames 已执行 → **searchSources 为空**。

## 剩余嫌疑(需 debug+metro 动态断点)

1. `session.fileExplorer` Map 在 workspace.tsx 读到的实例与 body 写入的不是同一个(双 store 实例?metro 路径 vs 打包路径的模块解析差异?)。
2. C12 hydration 竞态修复改变了 `hasHydratedWorkspaces` 前后 `sessions[serverId]` 的重建时机,搜索 memo 捕获的是旧 sessions 快照且后续无身份变化。
3. (detail)/files 路由(C16)传入 pane 的 serverId/workspaceId 与 store 键的规范化差异(trim/case)——但 favorite 路径同键,概率低。

## 复现步骤

release/debug 包:连接 → 工作区 → 打开 paseo-go 文件浏览 → 返回 → 搜索 `build` → 期望命中 BUILD.md,实际空态。

## 验收口径

修复后 release 真机:浏览根目录→返回→`build` 命中 BUILD.md;仅浏览过目录参与(范围提示不变);evidence 截图。

## 定性结论(C13-F1 动态探针,2026-09-26)

**三嫌疑全部排除——不存在代码回归;C13 零命中是输入法文本注入伪影(测试工具层)。**

方法:临时探针(store 模块实例 tag + sessions 对象身份 WeakMap 注册 + searchSources
各输入)走 debug+metro 快路径(BUILD.md §4;卡内复现口径 release/debug 均可复现,
debug 足以定性,免构建窗口)。UI 用 uiautomator 驱动,日志 `adb logcat -d -s ReactNativeJS`。

因果链(实测,同设备同 daemon 同操作序列):

1. 浏览写入侧健康:`WRITE key=workspace:wks_27fe… sessionsId=obj6@store#stzgc
explorer=workspace:wks_27fe…{dirs=2,entries=55}` —— 单 store 实例(全程仅一个
   tag,嫌疑①死)、`workspace:` 键正确(嫌疑③死)。
2. 搜索读取侧健康:`MEMO active=true captured=obj6 live=obj6 same=true …
sources=1 outEntries=55` —— memo 捕获的就是最新 sessions(嫌疑②死);
   **卡内"searchSources 为空"的前提不成立**。
3. 决定性实验:百度输入法下 `adb input keyevent` 注入 `build` → 输入框实际内容
   `builder`/`builder部idbbuidb`(滑词/预测候选吞并了提交文本)→ 空态「没有匹配的文件」
   ——与 C13 冒烟现象逐字一致。换 ADBKeyboard(`input text` 直提交,无预测)后
   **debug 与 release(在装正式包,sha 42b55f09)均一发命中** `BUILD.md`
   (evidence/C13F1/01-debug-clean-build-hit.png、02-release-build-hit.png、
   03-release-hit-preview.png=预览页实拍)。
4. 卡内「输入框确认只有 build」为观察误差:候选栏提交后输入框渲染文本与 RN 受控
   state 可不一致(候选吞字发生在 commitText 之前),截图空态带 icon 行只能证明
   query 非空,不能证明 query == "build"。

## 根治加固(伪影不可再骗过诊断 + 防真漂移)

- 写读键契约单一化:新增 `src/file-explorer/state-keys.ts`(`workspace:`/`root:`
  前缀 + `buildWorkspaceExplorerStateKey` 从 hook 迁出),浏览屏(pane/body/hook)与
  搜索索引共用;搜索侧抽出纯函数 `collectBrowsedWorkspaces`(workspace: 过滤+目录
  扁平化),workspace.tsx memo 调用它。
- 回归单测(file-search.test.ts 新增 4 例):真实键构造器写入→收集器读回、`root:`
  排除、多目录扁平化、`setFileExplorer` 替换 sessions 身份(搜索 memo 依赖)+
  全链命中 BUILD.md。写读任一侧漂移即红。
- 装机复验:重构后 debug(metro)真机命中;正式 APK phase1-4 重打后 release 真机
  复验(见卡尾 sha)。
- BUILD.md 输入配方更新:自动化文本注入必须 ADBKeyboard(见 BUILD.md §4)。

## 验收对照

- 定性结论:三选之外=第四因(输入法注入伪影),因果链如上。✔
- release 真机搜索命中实拍:在装正式包(42b55f09)01-03;重构重打正式包(1d4d20df)04-05,均一发命中。✔
- sha 更新:RELEASE.md 正式 APK 表(105,348,232 B / 1d4d20df…fd64;日志 build-c13f1-rebuild.log)。✔
- 零新增套件失败:见 stash 对照。

**改判**:C13 冒烟「文件搜索零命中 FAIL」按 PASS 记(勘误已落 todo/C13-release.md 卡尾;
冒烟全表口径 17/17,拖拽人工项不变)。
