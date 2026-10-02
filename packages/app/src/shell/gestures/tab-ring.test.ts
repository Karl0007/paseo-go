// B8-SWIPE acceptance (批次八 F26): the tab 环 decisions, pinned without a screen.
// The card's claims are the subject — 线性环 [进行中→已归档→工作区→我的→循环]、
// 双向循环（前进 4 步回原点、反向往返）、方向语义与段内滑一致（阈值=列宽 1/4 或
// 尾速、异轴让位垂直滚动/下拉刷新）、环无边界（每一格两侧都有页，墙规则随两页模型
// 一起退役）。B4-SWIPE 的阈值钉（slop>行机 8dp、300dp 列的 1/4=75dp、对角线归横轴）
// 原样迁入，改的是「不存在的那一页」不再是 fail 的理由。
import { describe, expect, it } from "vitest";
import { SHELL } from "@/shell/routes";
import {
  advanceRingSlot,
  clampRingSwipeTranslation,
  decideRingSwipeRelease,
  resolveRingSwipeIntent,
  retreatRingSlot,
  ringEntryEdge,
  ringExitEdge,
  ringSectionForSlot,
  ringSlotForDirection,
  ringSlotForView,
  ringTabPathForSlot,
  RING_ACTIVATE_SLOP_DP,
  RING_COMMIT_VELOCITY_DP_S,
  RING_COMMIT_WIDTH_FRACTION,
  RING_SLOT_CHATS_ARCHIVED,
  RING_SLOT_CHATS_ACTIVE,
  RING_SLOT_COUNT,
  RING_SLOT_ME,
  RING_SLOT_WORKSPACE,
  RING_VERTICAL_ESCAPE_DP,
  type RingSlot,
} from "./tab-ring";

/** 列宽取 MatePad 分栏 lg 列（300dp）量级：1/4 = 75dp，阈值可分辨（B4 同款）。 */
const WIDTH = 300;
const QUARTER = WIDTH * RING_COMMIT_WIDTH_FRACTION;

describe("ring slot mapping", () => {
  it("lays the four slots out in the ruling's reading order", () => {
    expect(RING_SLOT_CHATS_ACTIVE).toBe(0);
    expect(RING_SLOT_CHATS_ARCHIVED).toBe(1);
    expect(RING_SLOT_WORKSPACE).toBe(2);
    expect(RING_SLOT_ME).toBe(3);
    expect(RING_SLOT_COUNT).toBe(4);
  });

  it("projects (tab, filter) onto the slot and back onto the section", () => {
    expect(ringSlotForView("chats", false)).toBe(RING_SLOT_CHATS_ACTIVE);
    expect(ringSlotForView("chats", true)).toBe(RING_SLOT_CHATS_ARCHIVED);
    expect(ringSlotForView("workspace", true)).toBe(RING_SLOT_WORKSPACE);
    expect(ringSlotForView("me", false)).toBe(RING_SLOT_ME);
    expect(ringSectionForSlot(0)).toBe("chats");
    expect(ringSectionForSlot(1)).toBe("chats");
    expect(ringSectionForSlot(2)).toBe("workspace");
    expect(ringSectionForSlot(3)).toBe("me");
  });

  it("names the official tab paths for the cross-tab landing (rail 同串)", () => {
    expect(ringTabPathForSlot(0)).toBe(SHELL.chats);
    expect(ringTabPathForSlot(1)).toBe(SHELL.chats);
    expect(ringTabPathForSlot(2)).toBe(SHELL.workspace);
    expect(ringTabPathForSlot(3)).toBe(SHELL.me);
  });
});

describe("ring wrap arithmetic (F26 双向循环)", () => {
  it("advances four steps back to the start: 进行中→已归档→工作区→我的→进行中", () => {
    let slot: RingSlot = RING_SLOT_CHATS_ACTIVE;
    const seen: RingSlot[] = [slot];
    for (let i = 0; i < 4; i += 1) {
      slot = advanceRingSlot(slot);
      seen.push(slot);
    }
    expect(seen).toEqual([0, 1, 2, 3, 0]);
  });

  it("retreats four steps back to the start: 进行中→我的→工作区→已归档→进行中", () => {
    let slot: RingSlot = RING_SLOT_CHATS_ACTIVE;
    const seen: RingSlot[] = [slot];
    for (let i = 0; i < 4; i += 1) {
      slot = retreatRingSlot(slot);
      seen.push(slot);
    }
    expect(seen).toEqual([0, 3, 2, 1, 0]);
  });

  it("advances and retreats are inverses at every slot", () => {
    for (const slot of [0, 1, 2, 3] as const) {
      expect(retreatRingSlot(advanceRingSlot(slot))).toBe(slot);
      expect(advanceRingSlot(retreatRingSlot(slot))).toBe(slot);
    }
  });

  it("routes a direction through the same wrap arithmetic the release uses", () => {
    expect(ringSlotForDirection(3, "forward")).toBe(0);
    expect(ringSlotForDirection(0, "back")).toBe(3);
    expect(ringSlotForDirection(1, "forward")).toBe(2);
    expect(ringSlotForDirection(2, "back")).toBe(1);
  });
});

describe("resolveRingSwipeIntent", () => {
  it("keeps B4's geometry: activation slop above the row machine's 8dp swipe", () => {
    expect(RING_ACTIVATE_SLOP_DP).toBe(16);
    expect(RING_VERTICAL_ESCAPE_DP).toBe(10);
  });

  it("activates either horizontal direction at every slot — the ring has no wall", () => {
    // 旧两页模型的「进行中右滑不存在那一页→fail」正是 F26 废除的规则。
    for (const sign of [-1, 1]) {
      expect(resolveRingSwipeIntent({ deltaX: sign * RING_ACTIVATE_SLOP_DP, deltaY: 0 })).toBe(
        "activate",
      );
    }
  });

  it("hands vertical-dominant drags to the list (scroll / pull-to-refresh)", () => {
    expect(resolveRingSwipeIntent({ deltaX: 5, deltaY: 40 })).toBe("fail");
    expect(resolveRingSwipeIntent({ deltaX: -12, deltaY: 60 })).toBe("fail");
  });

  it("stays undecided below the slop, in either direction", () => {
    expect(resolveRingSwipeIntent({ deltaX: 0, deltaY: 0 })).toBe("wait");
    expect(resolveRingSwipeIntent({ deltaX: RING_ACTIVATE_SLOP_DP - 1, deltaY: 0 })).toBe("wait");
    expect(resolveRingSwipeIntent({ deltaX: -(RING_ACTIVATE_SLOP_DP - 1), deltaY: 0 })).toBe(
      "wait",
    );
  });

  it("gives the exact diagonal to the horizontal axis", () => {
    expect(resolveRingSwipeIntent({ deltaX: -20, deltaY: 20 })).toBe("activate");
    expect(resolveRingSwipeIntent({ deltaX: 20, deltaY: 20 })).toBe("activate");
  });

  it("does not escape vertically at or below the escape distance", () => {
    // |dy| 恰好 10 不算越轴（与官方/mobile-panel intent 同款边界）。
    expect(resolveRingSwipeIntent({ deltaX: 16, deltaY: 10 })).toBe("activate");
  });
});

describe("clampRingSwipeTranslation", () => {
  it("follows the finger both ways up to one page-width out", () => {
    expect(clampRingSwipeTranslation(-40, WIDTH)).toBe(-40);
    expect(clampRingSwipeTranslation(40, WIDTH)).toBe(40);
  });

  it("pins at the off-screen walls — 环无边界，但不露空白", () => {
    expect(clampRingSwipeTranslation(-WIDTH - 500, WIDTH)).toBe(-WIDTH);
    expect(clampRingSwipeTranslation(WIDTH + 500, WIDTH)).toBe(WIDTH);
  });

  it("moves nothing before the surface has a width", () => {
    expect(clampRingSwipeTranslation(-100, 0)).toBe(0);
  });
});

describe("ring edges", () => {
  it("sends 前进 to the left wall and enters the next slot from the right", () => {
    expect(ringExitEdge("forward", WIDTH)).toBe(-WIDTH);
    expect(ringEntryEdge("forward", WIDTH)).toBe(WIDTH);
  });

  it("sends 后退 to the right wall and enters from the left", () => {
    expect(ringExitEdge("back", WIDTH)).toBe(WIDTH);
    expect(ringEntryEdge("back", WIDTH)).toBe(-WIDTH);
  });
});

describe("decideRingSwipeRelease", () => {
  const V = RING_COMMIT_VELOCITY_DP_S;

  it("commits a quarter-width leftward drag forward around the ring", () => {
    expect(
      decideRingSwipeRelease({ translationX: -QUARTER, velocityX: 0, slot: 0, widthDp: WIDTH }),
    ).toEqual({ kind: "switch", direction: "forward", target: 1, exitEdge: -WIDTH });
  });

  it("commits a quarter-width rightward drag backward around the ring", () => {
    expect(
      decideRingSwipeRelease({ translationX: QUARTER, velocityX: 0, slot: 0, widthDp: WIDTH }),
    ).toEqual({ kind: "switch", direction: "back", target: 3, exitEdge: WIDTH });
  });

  it("wraps the loop commits: 我的 左滑→进行中、进行中 右滑→我的", () => {
    const wrap = decideRingSwipeRelease({
      translationX: -QUARTER,
      velocityX: 0,
      slot: RING_SLOT_ME,
      widthDp: WIDTH,
    });
    expect(wrap.kind === "switch" && wrap.target).toBe(RING_SLOT_CHATS_ACTIVE);
    const unroll = decideRingSwipeRelease({
      translationX: QUARTER,
      velocityX: 0,
      slot: RING_SLOT_CHATS_ACTIVE,
      widthDp: WIDTH,
    });
    expect(unroll.kind === "switch" && unroll.target).toBe(RING_SLOT_ME);
  });

  it("commits a flick below the distance threshold on tail velocity alone (裁定 10 另一半)", () => {
    const flick = decideRingSwipeRelease({
      translationX: -20,
      velocityX: -V - 1,
      slot: 1,
      widthDp: WIDTH,
    });
    expect(flick.kind === "switch" && flick.target).toBe(2);
  });

  it("cancels on a reverse flick regardless of travel", () => {
    expect(
      decideRingSwipeRelease({
        translationX: -QUARTER - 10,
        velocityX: V,
        slot: 0,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
    expect(
      decideRingSwipeRelease({
        translationX: QUARTER + 10,
        velocityX: -V,
        slot: 0,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("snaps back below both thresholds", () => {
    expect(
      decideRingSwipeRelease({ translationX: -QUARTER + 1, velocityX: 0, slot: 0, widthDp: WIDTH }),
    ).toEqual({ kind: "snap-back" });
    expect(
      decideRingSwipeRelease({ translationX: 20, velocityX: V - 1, slot: 0, widthDp: WIDTH }),
    ).toEqual({ kind: "snap-back" });
  });

  it("snaps on a dead release and without a measured width", () => {
    expect(
      decideRingSwipeRelease({ translationX: 0, velocityX: 0, slot: 0, widthDp: WIDTH }),
    ).toEqual({ kind: "snap-back" });
    expect(
      decideRingSwipeRelease({ translationX: -WIDTH, velocityX: -V, slot: 0, widthDp: 0 }),
    ).toEqual({ kind: "snap-back" });
  });

  it("picks the direction from velocity on a zero-translation pure flick", () => {
    const flick = decideRingSwipeRelease({
      translationX: 0,
      velocityX: -V - 1,
      slot: 3,
      widthDp: WIDTH,
    });
    expect(flick.kind === "switch" && flick.target).toBe(0);
  });
});
