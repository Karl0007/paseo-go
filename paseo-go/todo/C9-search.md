# C9 搜索：会话 + 文件名（+内容搜索 spike）

## 背景 / 用户拍板

DESIGN.md §8。基线 = C8 HEAD。

## 设计裁定（照此执行，不得重开）

- 对话 tab 搜索：即时过滤（标题/别名/项目名/最后动态），分组保持
- 工作区 tab 搜索：跨项目**文件名**搜索（官方 explorer/SDK 若已有 filename-search RPC 则用；无则对已加载目录树客户端过滤并写明局限）
- **内容全文搜索**：spike 上游 #4659 的搜索 RPC 是否已在协议/daemon 可用；可用则接入（结果行=文件:行:片段，点击→预览定位）；不可用 → 立 known_issue 卡（等上游），本卡不得自造全仓扫描
- 搜索态 UI：顶栏变形为输入框（取消按钮），结果替换列表区，键盘避让用官方 keyboard 设施

## 范围

- 动：`src/shell/components/search/**`、两个 tab 屏接线、locales
- 不动：官方源文件

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿（过滤函数单测：大小写/中英/空串）
3. 真实运行：会话搜索命中别名与项目名；文件搜索在双 host 上返回正确路径并可点开
4. 读图：≥2 张（两类搜索结果态）；报告含内容搜索 spike 结论

- 恰好一次 commit

## 结论（C9 完成 2026-09-25；两个 RPC 探测 + 实装）

### 探测结论

1. **filename-search RPC：无。** 协议 `file_explorer_request` mode 仅 `list|file`
   （packages/protocol/src/messages.ts:2709-2716），`FileExplorerResponseSchema` 同枚举（:5931）；
   `grep search packages/client/src` 只有 github/forge/timeline 搜索，无 explorer 面文件名搜索。
   真 daemon 实测（C:/tmp/c9-rpc-probe.mjs，两台 v0.9.2：srv_qwLjUbVgXsbm@6767、srv\_\_Nt1Bm50u1ci@6768）：
   `file_explorer_request mode:"search"` → `rpc_error code=unknown_schema`（"Unknown request, try upgrading the daemon"）。
   → 按裁定：客户端过滤 session-store 已加载目录树（`src/shell/search/file-search.ts`），
   局限写进空态文案=只覆盖本次运行浏览过的目录（`workspace.searchEmptyHint`）。
2. **内容全文搜索（上游 #4659）：不可用 → known_issue 等上游。**
   getpaseo/paseo#4659 "Search workspace file contents from the Command Center" 状态 OPEN、
   mergedAt=null，且 body 自述 stacked on #4589（feat/shared-pane-find-review，同样未合入）；
   协议无任何内容搜索消息类型（messages.ts 全文 literal 枚举仅 agent.timeline.search /
   forge.search / github_search / workspace.github.search_repositories）；
   两台真 daemon 发 `workspace.content_search.request` / `file_content_search_request` /
   `fs.search.request` 全部 `unknown_schema`。
   → 未自造全仓扫描。**known_issue（等上游）**：#4659 合入 daemon 后再接入内容搜索
   （结果行=文件:行:片段，点击→预览行定位；预览行定位参数彼时一并验证）。

### 实装

- 会话搜索：`src/shell/search/chat-filter.ts` 纯函数（别名 pins.aliases/标题/项目名/最后动态
  label，casefold 子串，分组保持+最近隐头规则复算）；chats-header 顶栏变形 SearchModeBar
  （输入框+取消，autoFocus），空查询恢复，取消恢复；搜索态禁拖拽（防过滤子集重写 pin 顺序）。
- 工作区搜索：`src/shell/search/file-search.ts`（explorer 缓存跨 host 收集、目录不命中、
  前缀优先/短名优先排序、去重、cap 60）；workspace 顶栏变形，结果替换树区，
  命中点击 → `shellPreviewHref` 直开 C6 预览。
- 键盘避让=官方设施：根 KeyboardProvider（react-native-keyboard-controller）+
  MainActivity adjustResize；顶栏锚顶永不被遮，取消键 Keyboard.dismiss。
- 单测：chat-filter.test.ts + file-search.test.ts 共 19 例（大小写/中英 CJK/空串/别名/
  项目名/分组保持/目录不命中/跨 host/去重/上限）。
- 真机证据 `evidence/C9/`（11 张，读图结论见卡外报告）：别名命中（火箭→火箭备份任务）、
  项目名命中（c5-proj）、动态命中（已完成）、无命中空态、取消恢复；文件搜索 "readme"
  双 host 命中（testID 含 srv_qwLjUbVgXsbm 与 srv\_\_Nt1Bm50u1ci 两键）、"中文" CJK 命中、
  点击命中→README 预览渲染。
