# C26 工作区 tab 三层树（工程→worktree→session）

## 背景 / 用户拍板

用户（原话见 NEXT-requirements Q8）：运行计数徽标困惑；行应可展开挂会话；**结构必须对齐底层数据模型：L1 工程 → L2 worktree → L3 session**（对话页=会话平铺，工作区页=三层树）；主视觉=工程名（现在的"长摘要"是 worktree 级标题，错位）；同 worktree 被拆行要合并（实测同目录 17 条记录，上游有意设计，展示层按物理身份合并）。裁定 DESIGN §14.8。

## 设计裁定（照此执行，不得重开）

1. **derive 重写**（`src/shell/workspace/derive.ts`）：host → L1 项目 → L2 worktree → L3 session。
   - L1 key=projectId（displayName=projectCustomName‖projectName）；
   - **L2 按物理身份合并**：规范化 cwd（realpath 意识：分隔符统一+大小写保留，参照 `preview-root.ts` 保守比较姿势）+branch；同目录多记录并一行，代表记录=updatedAt 最新；行标题=worktree 的 title‖displayName（摘要在此层归位）；
   - L3=该 worktree（含其合并前所有记录 id 集合）的 agents，按 chatLastEventAt 倒序；
   - 角标：L2=本 worktree 活跃数（`isWorkspaceAgentActive` 语义不变）；L1=旗下聚合；needs_input 存在→角标橙，否则 running→绿呼吸关（静态）。
2. **交互**：L1 行体=展开/收起（chevron 同步）；L2 行体=该 worktree 文件页（`shellFilesHref`）；L3 行体=会话屏（复用 C4 opener：markRead 双拍）；展开态=屏内 useState（不 persist，不跨启动）。
   - L3 长按=C3 五动作菜单（复用 ChatRowMenuContent/useShellAgentActions，勿重抄）；
   - L2 长按=复制 worktree 路径 + 归档工作区（官方 archiveWorkspace 可达则接，不可达则只做复制并报告）；L1 长按=无（主机 ⚙ 在 host header 已有）。
   - 本卡**不做** L3 拖拽（置顶只在对话 tab）。
3. 主机分组头/离线置灰重试/收藏区/快捷指令区/＋新建项目/＋连接新主机/搜索栏（C9 文件名搜索）全部**保持现状语义**，只是树层数变化；骨架屏/下拉刷新不回退。
4. 空态：无主机→连接引导（既有）；项目无 worktree→隐藏 L1（数据上不会出现）；worktree 无会话→展开显示"暂无会话"行（i18n）。

## 范围

- 动：`src/shell/workspace/derive.ts`（+derive.test 重写）、`src/app/(shell)/workspace.tsx`、新行组件（`src/shell/components/workspace-project-row.tsx` 改造 + worktree/session 行组件）、`workspace-command-row/favorite-row/host-header` 仅接线级改动、locales
- 不动：文件屏本体（C27）、对话 tab、C3 动作层本体、官方文件

## 工程约束

- derive 保持纯函数+fixture 测试；排序稳定性（同活跃数按 lastUsedAt 再字典序）。
- 与 C23/C25 无文件冲突；与 C27 有行语义依赖（C27 排后）。

## 验收（四项证据契约）

1. 门禁零错误。
2. 定向绿：derive 全矩阵（物理合并×多记录、聚合角标、层级排序、无会话 worktree）+ 行组件纯逻辑。
3. 真机：①paseo-go 只出**一个** L1 行（17 记录合并），展开见 worktree 行（含 main 与摘要名 worktree），再展开见会话；②点 L2→文件页路径正确；③点 L3→会话屏且未读清；④L3 长按五动作可用；⑤角标与对话 tab 灯一致；⑥离线主机置灰。
4. 读图 ≥6 存 `paseo-go/evidence/C26/`。

- 恰好一次 commit；报告 JSON（含 L2 长按取舍）。
