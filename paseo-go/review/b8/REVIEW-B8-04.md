# REVIEW-B8-04 [P2] resolveImportTarget 漏 cwd 折叠层，就地导入误判 crossWorkspace

## 现象

官方导入 sheet「显示全部」下导入本属当前 workspace 的会话，不走就地加 tab 分支而走跨 ws 导航，workspaceId 被省略。

## 根因

B8-COUNT 使 entry.cwd 出口恒折叠拼法（import-sessions.ts:224），`import-session-sheet-view-model.ts:234` resolveImportTarget 仍 withoutTrailingSlash 字面比；注册表存反斜杠形 → Windows 永不相等。姊妹函数 resolveDirectoryLabel 已两侧归一，此层漏。

## 修复方向

resolveImportTarget 两侧走同一 normalizeWorkspacePath（不造第二套）。

## 验收

回归断言：entryCwd="C:/work/paseo-go" vs workspaceCwd="C:\\work\\paseo-go" → crossWorkspace:false（修复前必红）；POSIX 恒等不受影响。

## 复核（RevB8）

**CONFIRMED（维持 P2）** — 探针实锤：throwaway vitest 直调 `resolveImportTarget`，entryCwd=`C:/work/paseo-go`（daemon 显示折，server 测 :1136 钉死）vs workspaceCwd=`normalizeWorkspacePath("C:\\work\\paseo-go")`=`c:/work/paseo-go`（session-store.ts:167 入口即折）→ 返回 `{crossWorkspace:true}`（红）；卡片字面例（反斜杠形）同样红；POSIX 绿。机制修正一处：app 侧 workspaceCwd 并非「注册表反斜杠原样」而是 store 入口已折成小写盘符 identity 形——但两形（大写盘显示形 vs 小写盘 identity 形）在 `withoutTrailingSlash` 字面比下仍永不相等，Windows 下 Show-all 导入同 ws 恒走 cross 分支的结论不变，修复方向（两侧 normalizeWorkspacePath）同时覆盖两种拼法。与 B8-06 同族不同层（此为 app view-model 消费侧），非重复立案。
