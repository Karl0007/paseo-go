// R2-22 acceptance: the L2 worktree menu's gate (cwd 空 → 复制禁用) is a pure,
// testable matrix — before this it lived only inside the row's JSX, so the one
// disable condition the menu carries had zero unit coverage and every future
// row would keep accreting logic into JSX.
import { describe, expect, it } from "vitest";
import { worktreeMenuPlan } from "./worktree-menu";

describe("worktreeMenuPlan (L2 长按菜单矩阵)", () => {
  it("carries 复制路径 → 归档工作区 in card order, both enabled for a real cwd", () => {
    expect(worktreeMenuPlan({ cwd: "C:/work/repo" })).toEqual([
      { id: "copyPath", enabled: true },
      { id: "archiveWorkspace", enabled: true },
    ]);
  });

  it("keeps 复制路径 present-but-disabled when the worktree has no cwd", () => {
    // 停止先例的形态：行不消失，只置灰——菜单形状跨状态稳定。
    expect(worktreeMenuPlan({ cwd: "" })).toEqual([
      { id: "copyPath", enabled: false },
      { id: "archiveWorkspace", enabled: true },
    ]);
  });
});
