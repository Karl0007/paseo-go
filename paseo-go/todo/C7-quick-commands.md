# C7 收藏快捷指令（D1 追加项）

## 背景 / 用户拍板

用户原话："收藏文件是基础。除此之外，如果有收藏快捷指令的功能就更好了，比如一键执行 xxx 之类的"。基线 = C6 HEAD。

## 设计裁定（照此执行，不得重开）

- 实体 `commands` store：`{id,name,hostId,workspaceId?,providerModel?,prompt,createdAt}`
- 渲染：工作区收藏夹区与文件混排，⚡ 前缀图标区分
- 点击执行：workspaceId 缺省→弹项目选择器（限该 host）；`agents.create({cwd,prompt,provider})` → push 进新会话；执行中按钮转 spinner，失败 toast 带原因
- 长按菜单：立即运行｜编辑（表单屏：名称/主机/项目/模型/prompt 多行）｜删除（确认）
- 创建入口：收藏夹区 ＋ 按钮 → 表单屏；对话内「存为快捷指令」（composer 溢出注入，若 C4 判定不可注入则此入口排 known_issue）
- 名称必填，prompt 必填，其余可空

## 范围

- 动：`src/app/(shell)/commands/**`（表单屏）、`src/shell/stores/commands.ts`、收藏夹区组件、locales
- 不动：官方源文件

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿（表单校验/执行参数组装单测：workspace 缺省路径、host 离线报错）
3. 真实运行：创建指令（如"列出 idle-game 目录结构"）→ 一键执行 → 新会话自动运行并进入 → 编辑/删除生效 → 重启持久
4. 读图：≥4 张（混排收藏夹、表单屏、执行后自动进入会话、长按菜单）

- 恰好一次 commit
