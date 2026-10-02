// B8-FILESWIP (批次八 F29) — the pure half of the 文件页三段屏内横滑: the LINEAR
// (非循环) pager over 文件 | 变更 | 提交 (`shell/files/files-tabs`), its direction
// lock with the boundary-throw rule, and the release decision. The thresholds
// are the ring's numbers verbatim (16dp slop / 10dp 垂直逃逸 / ¼ 列宽 / 500dp/s
// 尾速, all imported from `tab-ring` — 同参数组，一处真源); the ONLY arithmetic
// difference is the topology: the ring loops, the segments DON'T. A direction
// without a neighbour is not a wall to bounce off and never a wrap — it is the
// cascade's hand-off point: this module answers FAIL and the touch stream falls
// through to the panes' ANCESTOR surface (RNGH 的 structurally-proven semantics:
// a failing descendant releases the same stream to the awaiting ancestor pan; an
// activating descendant CANCELS the ancestor, orchestrator `makeActive`).
//
// 边界级联 (冻结口径, 卡 B8-FILESWIP + 编排者纠偏):
//   最左「文件」+ 手指右滑 → FAIL 让位 —— 栈页的祖先面 = ShellStackBackHost
//     (F27 全宽右滑返回 → pop)，tab 宿主(若未来重挂)的祖先面 = 主环 Pan
//     (workspace→archived 后退)。内层绝不 wrap 到最右段。
//   最右「提交」+ 手指左滑 → FAIL 让位 —— tab 宿主=主环前进 (workspace→me)；
//     栈页祖先面对左滑恒 FAIL (F27 堆叠优先)，所以「栈页最右无外抛」是结构事实。
//   中段双向 = 普通换段（右滑回左邻、左滑进右邻）。
//   非 git checkout 灰两段 → count=1 → 任何方向都无邻 → 内滑全 FAIL 只剩外抛。
//
// Units: dp end to end, same no-PixelRatio posture as `tab-ring` (RNGH reports
// pointer/translation/velocity in dp on Android; Reanimated drives translateX
// in dp). Follow geometry (clamp/exit/entry walls) IS the ring's — imported,
// not forked: linear vs loop is a target-arithmetic difference only.

import { FILES_SCREEN_TABS, type FilesScreenTab } from "../files/files-tabs";
import {
  RING_ACTIVATE_SLOP_DP,
  RING_VERTICAL_ESCAPE_DP,
  RING_COMMIT_WIDTH_FRACTION,
  RING_COMMIT_VELOCITY_DP_S,
  ringExitEdge,
  type RingSwipeIntent,
} from "./tab-ring";

/** 前进 = 手指左滑 → 右边段；后退 = 手指右滑 → 左边段（与环/段内滑同方向语义）。 */
export type FilesSegmentDirection = "forward" | "back";

/** 三段 → 线性序号（FILES_SCREEN_TABS 就是顺序真源）。 */
export function filesSegmentIndexForTab(tab: FilesScreenTab): number {
  return FILES_SCREEN_TABS.indexOf(tab);
}

/** 序号 → 段（越界 = null，落地动词的防御闸）。 */
export function filesSegmentTabForIndex(index: number): FilesScreenTab | null {
  return FILES_SCREEN_TABS[index] ?? null;
}

/** The inner pager's posture the arbiter reads mid-touch. */
export interface FilesSegmentPosture {
  /** 当前段序号（activeTab 投影：0=文件 1=变更 2=提交）。 */
  index: number;
  /** 可滑段数：git checkout=3；非 git 灰两段=1（无内滑只剩外抛）。 */
  count: number;
}

/**
 * 线性邻段：越界 = null = 边界（级联外抛的唯一真源）。绝不回卷——
 * 首段 + 后退 永远 null（外抛），永不成为末段；末段 + 前进同理。
 */
export function filesSegmentNeighbor(
  index: number,
  direction: FilesSegmentDirection,
  count: number,
): number | null {
  "worklet";
  const target = direction === "forward" ? index + 1 : index - 1;
  return target >= 0 && target < count ? target : null;
}

/**
 * Direction lock for one touch (环同款阈值): vertical dominance escapes to the
 * pane's scroll views; horizontal past the slop decides by the NEIGHBOUR table
 * — activate only when the direction has a segment to land on, FAIL at every
 * boundary so the ancestor surface (stack-back host / tab ring) takes the SAME
 * touch stream (级联 = 同流移交，RNGH 语义可行解，卡主拍板口径).
 */
export function resolveFilesSegmentSwipeIntent(
  input: { deltaX: number; deltaY: number },
  posture: FilesSegmentPosture,
): RingSwipeIntent {
  "worklet";
  const absX = Math.abs(input.deltaX);
  const absY = Math.abs(input.deltaY);
  if (absY > RING_VERTICAL_ESCAPE_DP && absY > absX) return "fail";
  if (absX < RING_ACTIVATE_SLOP_DP) return "wait";
  const direction: FilesSegmentDirection = input.deltaX < 0 ? "forward" : "back";
  return filesSegmentNeighbor(posture.index, direction, posture.count) === null
    ? "fail"
    : "activate";
}

export type FilesSegmentRelease =
  | {
      readonly kind: "switch";
      readonly direction: FilesSegmentDirection;
      readonly target: number;
      readonly exitEdge: number;
    }
  | { readonly kind: "snap-back" };

const SNAP_BACK: FilesSegmentRelease = { kind: "snap-back" };

/**
 * Release decision — 环同款判定（行程过 ¼ 列宽或尾速过 500dp/s 即换段，方向由
 * 位移符号定、零位移的纯甩动由尾速定，反向尾速无论行程都取消）；唯一差异是
 * 目标算术：线性邻段，越界 = snap-back。wrap 在这里再钉死一遍（激活闸已挡，
 * 这是第二道：哪怕手势在边界错误地激活了，释放也绝不跳到对侧段）。
 */
export function decideFilesSegmentRelease(input: {
  translationX: number;
  velocityX: number;
  posture: FilesSegmentPosture;
  widthDp: number;
}): FilesSegmentRelease {
  "worklet";
  const { translationX, velocityX, posture, widthDp } = input;
  if (widthDp <= 0) return SNAP_BACK;
  let direction: FilesSegmentDirection | null = null;
  if (translationX < 0) direction = "forward";
  else if (translationX > 0) direction = "back";
  else if (velocityX < 0) direction = "forward";
  else if (velocityX > 0) direction = "back";
  if (direction === null) return SNAP_BACK;
  const forward = direction === "forward";
  // 反向尾速=用户往回甩（把手指收向出发的方向），无论行程多少都取消换段。
  const reverseFlick = forward
    ? velocityX >= RING_COMMIT_VELOCITY_DP_S
    : velocityX <= -RING_COMMIT_VELOCITY_DP_S;
  if (reverseFlick) return SNAP_BACK;
  const distanceCommit = forward
    ? translationX <= -widthDp * RING_COMMIT_WIDTH_FRACTION
    : translationX >= widthDp * RING_COMMIT_WIDTH_FRACTION;
  const velocityCommit = forward
    ? velocityX <= -RING_COMMIT_VELOCITY_DP_S
    : velocityX >= RING_COMMIT_VELOCITY_DP_S;
  if (!distanceCommit && !velocityCommit) return SNAP_BACK;
  const target = filesSegmentNeighbor(posture.index, direction, posture.count);
  if (target === null) return SNAP_BACK;
  return {
    kind: "switch",
    direction,
    target,
    exitEdge: ringExitEdge(direction, widthDp),
  };
}
