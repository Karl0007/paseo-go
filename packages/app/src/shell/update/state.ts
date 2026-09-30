// In-memory update-check state (M4 slice 2), shared by the startup banner and the
// 我的 manual row so both observe ONE check machine. Deliberately NOT persisted:
// what survives restarts is only「这个版本提示过了没有」— see stores/updateNotice.
import { create } from "zustand";
import { runUpdateCheck, type UpdateCheckResult } from "./checker";

export type ShellUpdatePhase = "idle" | "checking" | "upToDate" | "available" | "error";

interface ShellUpdateState {
  phase: ShellUpdatePhase;
  latest: string | null;
  url: string | null;
  /** Startup auto-check fires once per JS context even if the caller forgets its guard. */
  checkedOnce: boolean;
  /**
   * `force=false` = startup probe (skipped after the first run); `force=true` =
   * 设置页手动「检查更新」强拉. Returns null when the call was a no-op (a check is
   * already in flight, or the startup probe already ran) — callers must not toast
   * a null.
   */
  runCheck: (force?: boolean) => Promise<UpdateCheckResult | null>;
}

export const useShellUpdateStore = create<ShellUpdateState>()((set, get) => ({
  phase: "idle",
  latest: null,
  url: null,
  checkedOnce: false,
  runCheck: async (force = false) => {
    if (get().phase === "checking") return null;
    if (get().checkedOnce && !force) return null;
    set({ phase: "checking", checkedOnce: true });
    const result = await runUpdateCheck();
    set({ phase: result.state, latest: result.latest, url: result.url });
    return result;
  },
}));

/**
 * Banner rule (card: 一次性提示条): show only on a fresh `available` result whose
 * version the user has not seen/dismissed yet (store flag). Same version → once;
 * a newer version re-arms the banner.
 */
export function shouldShowBanner(args: {
  phase: ShellUpdatePhase;
  latest: string | null;
  seenVersion: string | null;
}): boolean {
  return args.phase === "available" && args.latest !== null && args.seenVersion !== args.latest;
}
