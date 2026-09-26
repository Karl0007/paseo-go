# C17 新建对话直达官方 /new 屏

## 背景 / 用户拍板

用户：「点了加号新建会话之后。我其实希望弹出的是这个界面。」（截图=官方"新建 workspace"屏：项目/主机/Chat 三选择器 + composer）。现状 `handleNewChat = openAddProject()`（add-project 过渡流程）不对味。裁定见 DESIGN §14.7。

## 设计裁定（照此执行，不得重开）

- `src/app/(shell)/chats.tsx` 的 `handleNewChat`：从 `useOpenAddProject()` 改为 push 官方 `/new` 根路由（`app/new.tsx`，参数 `serverId`）。
- serverId 选择：`useShellHostStatuses`（R1 缓解 hook，勿用官方聚合）取**第一个在线主机**；无在线但有主机→取第一个主机（屏内自呈现离线态）；无任何主机→走现有 `handleConnectHost`（空态按钮同此逻辑，本来就走 hasHosts 分支）。
- 路由串进 `src/shell/routes.ts`：`OFFICIAL.newWorkspace = (serverId: string) => ({ pathname: "/new", params: { serverId } })`（对象形式，编码归 expo-router，routes.test 钉住）。
- **不动** add-project 流程（工作区 tab「＋新建项目」继续用它）；`useOpenAddProject` import 若壳内不再使用则移除该 import。

## 范围

- 动：`src/app/(shell)/chats.tsx`、`src/shell/routes.ts`、`src/shell/routes.test.ts`
- 不动：`app/new.tsx`、NewWorkspaceScreen、add-project 流程、官方任何文件

## 工程约束

- 壳代码只进 `src/shell/**` 与 `(shell)/**`；路由串唯一出处 routes.ts。
- React Compiler 开启（app.config.js）——hook 依赖必须真实读取（R1 教训）。
- 套件口径：只跑定向测试文件（`npx vitest run src/shell/routes.test.ts` 等，`--pool=threads --maxWorkers=2`，NODE_OPTIONS=--max-old-space-size=2048）；全量对照由编排者批尾执行（W1 口径）。

## 验收（四项证据契约）

1. `npm run typecheck` + `npm run lint`（仓根）零错误。
2. 定向套件绿：routes.test（+newWorkspace builder 断言）、chats 相关既有测试无新增失败。
3. 真机（BUILD.md §4 闭环，metro 快路径）：＋菜单→新建对话 → 直达"新建 workspace"屏（三选择器+composer 渲染）；返回键回对话列表；无主机态点空态「新建对话」→ 连接主机引导不变。
4. 读图 ≥2 存 `paseo-go/evidence/C17/`（直达屏 + 返回落位）。

- 恰好一次 commit；报告 JSON：commit/per_item/verification/grep/known_issues。
