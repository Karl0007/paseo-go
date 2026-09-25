# C16 修复：胶囊"查看项目文件"弹掉会话屏（navigate-reuse）

## 背景 / 用户拍板

C14 真机实证：胶囊菜单"查看项目文件"→ push `(shell)/files/...` 被 expo-router 解析为**导航进既有 (shell) 组入口**（navigate-reuse），会话屏被弹掉；back 从 files 回壳列表而非会话。`router.push` 与定向 `StackActions.push(target=根栈key)` 两种写法实测同行为（框架语义）。可接受度：功能可用但返回路径不符合预期，属 P1 体验缺陷。

## 修复方向（编排者预研）

files 屏存在第二实例路径：`(detail)/files/[serverId]/[workspaceId]`——`(detail)` 组是根 Stack 兄弟节点，push 它=真压栈在会话屏之上，back 自然回会话。做法：把现有 files 屏内容抽成共享组件 `src/shell/components/files-screen-body.tsx`（或路由参数复用同组件），`(shell)/files/...`（tab 内入口）与 `(detail)/files/...`（胶囊入口）都是薄壳。注意 files 屏当前的 hidden-tab+BackHandler 逻辑只在 (shell) 实例需要，(detail) 实例用真栈返回。

## 范围

- 动：`src/shell/components/files-screen-body.tsx`（抽取）、`(shell)/files/**`（薄壳化）、`(detail)/files/**`（新薄壳）、`shell-session-header.tsx`（改 push 目标）、routes.ts
- 不动：官方文件

## 验收

1. 门禁全量绿 2. 套件 stash 对照无新增 3. 真机：会话→胶囊→查看文件→**back 回会话**（连拍/双截图证明栈序）；tab 入口 files 行为不回退 4. 读图 ≥2 张存 evidence/C16/

- 恰好一次 commit
