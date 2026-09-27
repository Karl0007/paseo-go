// L2 worktree 长按菜单的纯矩阵（R2-22，对齐 chatMenuPlan 姿势）：可见项与禁用
// 条件只活在这里，行组件按 plan 渲染 label/icon/dispatch。归档始终在场（C26：
// 走官方 archiveWorkspace RPC，乐观隐藏在 workspace-archive 一侧）；「复制
// worktree 路径」在 cwd 缺失时 present-but-disabled（停止先例——菜单形态跨
// 状态稳定，用户永远看得到动作、只是点不动）。
export type WorktreeMenuActionId = "copyPath" | "archiveWorkspace";

export interface WorktreeMenuRowState {
  /** 合并后代表记录的 cwd；空串=无路径可复制。 */
  cwd: string;
}

export interface WorktreeMenuPlanItem {
  id: WorktreeMenuActionId;
  enabled: boolean;
}

/** 行序=卡面序：复制路径 → 归档工作区。 */
export function worktreeMenuPlan(state: WorktreeMenuRowState): WorktreeMenuPlanItem[] {
  return [
    { id: "copyPath", enabled: state.cwd.length > 0 },
    { id: "archiveWorkspace", enabled: true },
  ];
}
