// KI-15 验收①：骨架门归位条件的定向单测。
// 钉死两件事：
// 1. 冷启动遮蔽仍在（registry loading / 首波未落且无已完成主机 → 骨架）；
// 2. KI-15 回归本体：一台不可达主机恒 connecting（projectsLoading 永真）时，
//    只要另一台已完成首波（anyHostEverLoaded），骨架必须放行 —— 真机上这条
//    失效导致列表被骨架钉死 40+ 分钟（evidence/KI15/01）。
// 以及超时兑底的分支优先序：搜索 > 骨架 > 超时错误态 > 树 > 空态。
import { describe, expect, it } from "vitest";
import {
  pickWorkspaceBodyBranch,
  shouldShowWorkspaceSkeleton,
  WORKSPACE_SKELETON_TIMEOUT_MS,
  type WorkspaceSkeletonGateInput,
} from "@/shell/workspace/skeleton-gate";

function gate(overrides: Partial<WorkspaceSkeletonGateInput> = {}): WorkspaceSkeletonGateInput {
  return {
    hostRegistryStatus: "ready",
    hostCount: 1,
    projectsLoading: true,
    isInitialLoad: true,
    anyHostEverLoaded: false,
    ...overrides,
  };
}

describe("shouldShowWorkspaceSkeleton", () => {
  it("masks while the host registry is still loading (host set unknown)", () => {
    expect(shouldShowWorkspaceSkeleton(gate({ hostRegistryStatus: "loading", hostCount: 0 }))).toBe(
      true,
    );
  });

  it("never masks with no hosts (the 连接新主机 empty state owns that screen)", () => {
    expect(shouldShowWorkspaceSkeleton(gate({ hostCount: 0 }))).toBe(false);
  });

  it("masks the cold-start gap: first directory wave in flight, nothing landed", () => {
    expect(shouldShowWorkspaceSkeleton(gate())).toBe(true);
    expect(
      shouldShowWorkspaceSkeleton(
        gate({ projectsLoading: false, isInitialLoad: true, anyHostEverLoaded: false }),
      ),
    ).toBe(true);
  });

  it("KI-15 regression: a host stuck in connecting cannot pin the skeleton once any host landed", () => {
    // 真机取证态：在线主机 dir=ready/ever=true，不可达主机恒 connecting →
    // projectsLoading 聚合恒真、isInitialLoad=false。门必须放行。
    expect(
      shouldShowWorkspaceSkeleton(
        gate({
          hostCount: 2,
          projectsLoading: true,
          isInitialLoad: false,
          anyHostEverLoaded: true,
        }),
      ),
    ).toBe(false);
  });

  it("releases once everything settled", () => {
    expect(
      shouldShowWorkspaceSkeleton(
        gate({ projectsLoading: false, isInitialLoad: false, anyHostEverLoaded: true }),
      ),
    ).toBe(false);
  });

  it("keeps masking while the ONLY host has not completed its first wave", () => {
    expect(shouldShowWorkspaceSkeleton(gate({ anyHostEverLoaded: false }))).toBe(true);
  });
});

describe("pickWorkspaceBodyBranch", () => {
  it("search replaces everything (C9 ruling)", () => {
    expect(
      pickWorkspaceBodyBranch({
        searchActive: true,
        showSkeleton: true,
        skeletonTimedOut: true,
        hasHosts: true,
      }),
    ).toBe("search");
  });

  it("skeleton only while inside the timeout budget", () => {
    expect(
      pickWorkspaceBodyBranch({
        searchActive: false,
        showSkeleton: true,
        skeletonTimedOut: false,
        hasHosts: true,
      }),
    ).toBe("skeleton");
  });

  it("a stuck skeleton flips to the retryable error state — never an unbounded skeleton", () => {
    expect(
      pickWorkspaceBodyBranch({
        searchActive: false,
        showSkeleton: true,
        skeletonTimedOut: true,
        hasHosts: true,
      }),
    ).toBe("skeletonTimeout");
    // 超时态优先于空态（registry 卡死时不许假称「还没有主机」）
    expect(
      pickWorkspaceBodyBranch({
        searchActive: false,
        showSkeleton: true,
        skeletonTimedOut: true,
        hasHosts: false,
      }),
    ).toBe("skeletonTimeout");
  });

  it("tree with hosts, empty state without", () => {
    const settled = { searchActive: false, showSkeleton: false, skeletonTimedOut: false };
    expect(pickWorkspaceBodyBranch({ ...settled, hasHosts: true })).toBe("tree");
    expect(pickWorkspaceBodyBranch({ ...settled, hasHosts: false })).toBe("empty");
  });

  it("the timeout budget is 10s (card ruling: 用户永远不该看到 40 分钟骨架)", () => {
    expect(WORKSPACE_SKELETON_TIMEOUT_MS).toBe(10_000);
  });
});
