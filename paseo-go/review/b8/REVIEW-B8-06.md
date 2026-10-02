# REVIEW-B8-06 [P2] normalizeProviderSessionDisplayCwd 第三套路径折叠，\\?\\UNC\\ 与真相源发散

## 现象

`\\?\\UNC\\server\\share\\repo` 形 cwd 显示原样设备前缀串；workspace-identity 注释明令 path.ts 为真相源「do not diverge」。

## 根因

`import-sessions.ts:273,292-295` 自写 WINDOWS_NAMESPACE_PREFIX 只剥前缀，剥后 UNC 设备形三形状全不命中→原样返回；真相源 `utils/path.ts:stripWindowsNamespacePrefix`(:190) 会重建 `\\server\\share`。匹配未破（app 侧重折兜底），显示回退暴露+无测。

## 修复方向

复用 utils/path.ts 既有 strip（或导出面向展示的折叠选项），删自写前缀正则；补 `\\?\\UNC\\` 用例。

## 验收

回归断言 `\\?\\UNC\\server\\share\\repo` → `\\server\\share\\repo`（修复前必红）；盘符大小写口径在函数注释写明与 app 镜像的关系。

## 复核（RevB8）

**DOWNGRADE→P3** — 发散实证：throwaway 探针跑真函数，`normalizeProviderSessionDisplayCwd("\\\\?\\UNC\\server\\share\\repo")` 原样返回（剥 `\\?\` 后剩 `UNC\server\share\repo` 三形状全不命中），而真相源 `utils/path.ts:189 stripWindowsNamespacePrefix` 重建 `\\server\share\repo`——发散为真、无测为真。但「daemon 真会发吗」核下来发不出：provider 描述符 cwd 全是 provider CLI 自记的进程 cwd（claude transcript cwd 字段 / codex thread/list cwd），Node `process.cwd()` 在 UNC 下返回 `\\server\share` 形（已被测 :1145 覆盖）；daemon 内 `realpathSync.native` 仅两处（provider-transcript.ts:141、claude/agent.ts:5106）都只作候选路径查 transcript 文件，结果不回流 payload.cwd；`\\?\UNC\` 需外部 writer 用 canonicalize 类 API 记录 cwd，本仓无此证据。影响=显示回退且 app 侧 normalizeWorkspacePath 已兜底匹配。按「不发则降级」口径降 P3：函数自身 `\\?\` 契约的漏网姊妹形（盘符形 :1144 已测）+ 复用 strip 的廉价防御。
