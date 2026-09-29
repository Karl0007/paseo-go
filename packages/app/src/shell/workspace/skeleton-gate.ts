// KI-15: the 工作区 tab skeleton gate as pure logic.
//
// The skeleton is a cold-start mask (C12: don't flash 「暂无项目」 under still-arriving
// agents), NOT an all-hosts barrier. Device-proven failure (evidence/KI15/): one
// unreachable host sits in `connecting` forever, `isHostRuntimeDirectoryLoading` counts
// that as loading, and `useProjects` aggregates with `.some()` — so `projectsLoading`
// never settles and the ready hosts' tree stayed hidden behind the skeleton for 40+
// minutes. Gate rule: once ANY host has completed its first agent-directory wave
// (`hasEverLoadedAgentDirectory`), the tab renders the tree; connecting/offline hosts
// surface as their own greyed rows with retry (buildWorkspaceTree already does this).
//
// Second half of the contract: a skeleton must never be unbounded. After
// WORKSPACE_SKELETON_TIMEOUT_MS the body branch flips to an error state with retry —
// whatever upstream state machine failed to settle, the user gets an escape hatch.
import type { HostRegistryStatus } from "@/runtime/host-runtime";

export const WORKSPACE_SKELETON_TIMEOUT_MS = 10_000;

export interface WorkspaceSkeletonGateInput {
  hostRegistryStatus: HostRegistryStatus;
  hostCount: number;
  /** useProjects().isLoading — any host's directory still loading. */
  projectsLoading: boolean;
  /** useAggregatedAgents().isInitialLoad — first directory wave, no rows yet. */
  isInitialLoad: boolean;
  /** Some host completed its first agent-directory wave this session. */
  anyHostEverLoaded: boolean;
}

export function shouldShowWorkspaceSkeleton(input: WorkspaceSkeletonGateInput): boolean {
  // Registry not hydrated yet: we don't even know the host set — mask.
  if (input.hostRegistryStatus === "loading") return true;
  if (input.hostCount === 0) return false;
  // KI-15: a settled host means there is real content to show; an unreachable
  // sibling stuck in `connecting` must not keep masking it.
  if (input.anyHostEverLoaded) return false;
  return input.projectsLoading || input.isInitialLoad;
}

export type WorkspaceBodyBranch = "search" | "skeleton" | "skeletonTimeout" | "tree" | "empty";

export interface WorkspaceBodyBranchInput {
  searchActive: boolean;
  showSkeleton: boolean;
  /** The skeleton crossed WORKSPACE_SKELETON_TIMEOUT_MS without settling. */
  skeletonTimedOut: boolean;
  hasHosts: boolean;
}

export function pickWorkspaceBodyBranch(input: WorkspaceBodyBranchInput): WorkspaceBodyBranch {
  if (input.searchActive) return "search";
  if (input.showSkeleton) return input.skeletonTimedOut ? "skeletonTimeout" : "skeleton";
  return input.hasHosts ? "tree" : "empty";
}
