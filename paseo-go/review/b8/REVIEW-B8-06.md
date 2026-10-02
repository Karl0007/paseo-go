# REVIEW-B8-06 [P2] normalizeProviderSessionDisplayCwd 第三套路径折叠，\\?\\UNC\\ 与真相源发散

## 现象

`\\?\\UNC\\server\\share\\repo` 形 cwd 显示原样设备前缀串；workspace-identity 注释明令 path.ts 为真相源「do not diverge」。

## 根因

`import-sessions.ts:273,292-295` 自写 WINDOWS_NAMESPACE_PREFIX 只剥前缀，剥后 UNC 设备形三形状全不命中→原样返回；真相源 `utils/path.ts:stripWindowsNamespacePrefix`(:190) 会重建 `\\server\\share`。匹配未破（app 侧重折兜底），显示回退暴露+无测。

## 修复方向

复用 utils/path.ts 既有 strip（或导出面向展示的折叠选项），删自写前缀正则；补 `\\?\\UNC\\` 用例。

## 验收

回归断言 `\\?\\UNC\\server\\share\\repo` → `\\server\\share\\repo`（修复前必红）；盘符大小写口径在函数注释写明与 app 镜像的关系。
