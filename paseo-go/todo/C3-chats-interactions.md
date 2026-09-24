# C3 对话交互：长按菜单 + 置顶/归档/重命名/删除 + 拖拽排序

## 背景 / 用户拍板
DESIGN.md §4（D4：拖拽必做）。基线 = C2 HEAD。

## 设计裁定（照此执行，不得重开）
- 长按=Android 原生上下文菜单（官方 #5117 范式，组件可 import 则复用）：置顶/取消置顶、重命名、归档、停止、删除
- 停止/删除=daemon 真实操作，删除二次确认；重命名=壳本地别名（pins store `alias`），不改 daemon
- 置顶排序：`react-native-draggable-flatlist`（官方依赖+patch 已存在）；仅已置顶分组内可拖；拖起触觉+抬升反馈
- 归档：archive store；顶栏筛选（进行中/已归档）；已归档行菜单=取消归档/删除
- 全操作触觉反馈；行级增删动画，禁止整列表闪刷

## 范围
- 动：`src/app/(shell)/chats.tsx`、`src/shell/components/**`、`src/shell/stores/{pins,archive}.ts`、locales
- 不动：官方源文件

## 工程约束
- 菜单动作收敛到 `src/shell/shellAgentActions.ts`（唯一出处，C4/C11 复用）
- draggable-flatlist × 下拉刷新共存是已知坑：真机验证互不干扰，截图为证

## 验收（四项证据契约）
1. typecheck+lint 零错误
2. app 包测试全绿；pins 排序持久化/归档迁移单测（边界：重复置顶、取消归档、跨重启恢复）
3. 真实运行：长按出原生菜单→置顶→拖拽换位→杀 app 重启顺序保留；归档/取消归档；停止/删除对真实 agent 生效（daemon 侧核对）
4. 读图：≥4 张（菜单展开、拖拽中、归档筛选态、重启后顺序）
+ 恰好一次 commit