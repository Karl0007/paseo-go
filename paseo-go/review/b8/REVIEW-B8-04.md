# REVIEW-B8-04 [P2] resolveImportTarget 漏 cwd 折叠层，就地导入误判 crossWorkspace

## 现象

官方导入 sheet「显示全部」下导入本属当前 workspace 的会话，不走就地加 tab 分支而走跨 ws 导航，workspaceId 被省略。

## 根因

B8-COUNT 使 entry.cwd 出口恒折叠拼法（import-sessions.ts:224），`import-session-sheet-view-model.ts:234` resolveImportTarget 仍 withoutTrailingSlash 字面比；注册表存反斜杠形 → Windows 永不相等。姊妹函数 resolveDirectoryLabel 已两侧归一，此层漏。

## 修复方向

resolveImportTarget 两侧走同一 normalizeWorkspacePath（不造第二套）。

## 验收

回归断言：entryCwd="C:/work/paseo-go" vs workspaceCwd="C:\\work\\paseo-go" → crossWorkspace:false（修复前必红）；POSIX 恒等不受影响。
