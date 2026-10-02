// B8-SWIPE acceptance (批次八 F26+F27): the ONE arbiter's decisions, pinned
// without a screen. The card's three demanded properties are the subjects:
//   堆叠页返回优先 — a touch on a stack page is judged ONLY by the stack-back
//     branch: rightward pops, leftward FAILS (堆叠页上左滑不切 tab), and the
//     tab-ring role is never returned;
//   声明性豁免 — a registered horizontal surface scrolled off its leading edge
//     keeps its own swipe; both branches lose to it, as both lose to the
//     surface's own blocked band (拖拽/搜索态/换页中);
//   环双向 — on a root tab, rightward activates the ring's 后退 and leftward
//     its 前进 (the ring half of the loop arithmetic is tab-ring.test.ts's).
import { describe, expect, it } from "vitest";
import { DETAIL_ROOT_ROUTE, SHELL_ROOT_ROUTE } from "@/shell/routes";
import { decideShellSwipe, isDetailGroupFrontmost } from "./swipe-machine";

const OPEN_GATE = { stackInFront: false, blocked: false, horizontalScrolled: false };

describe("decideShellSwipe — 堆叠页返回优先 (F27)", () => {
  const stack = { ...OPEN_GATE, stackInFront: true };

  it("a rightward horizontal drag on a stack page is a 返回, never a tab switch", () => {
    expect(decideShellSwipe({ deltaX: 40, deltaY: 0 }, stack)).toEqual({
      role: "stack-back",
      intent: "back",
    });
  });

  it("a leftward drag on a stack page FAILS — 返回栈优先，不切 tab", () => {
    // 环前进的方向在堆叠页上必须哑火：若把它交给 tab-ring，push 屏上左滑会偷切页签。
    const decision = decideShellSwipe({ deltaX: -40, deltaY: 0 }, stack);
    expect(decision.role).toBe("stack-back");
    expect(decision.intent).toBe("fail");
  });

  it("hands the stack page's vertical drags to its scroll views", () => {
    expect(decideShellSwipe({ deltaX: 5, deltaY: 60 }, stack).intent).toBe("fail");
  });

  it("waits below the 24dp activation and inside the undecided diagonal", () => {
    expect(decideShellSwipe({ deltaX: 10, deltaY: 0 }, stack).intent).toBe("wait");
  });

  it("never returns the tab-ring role while a stack owns the front", () => {
    for (const d of [
      { deltaX: 40, deltaY: 0 },
      { deltaX: -40, deltaY: 0 },
      { deltaX: 0, deltaY: 40 },
      { deltaX: 30, deltaY: 30 },
    ]) {
      expect(decideShellSwipe(d, stack).role).toBe("stack-back");
    }
  });
});

describe("decideShellSwipe — tab 环 (F26)", () => {
  it("leftward activates the ring (前进), rightward activates it too (后退)", () => {
    expect(decideShellSwipe({ deltaX: -20, deltaY: 0 }, OPEN_GATE)).toEqual({
      role: "tab-ring",
      intent: "activate",
    });
    expect(decideShellSwipe({ deltaX: 20, deltaY: 0 }, OPEN_GATE)).toEqual({
      role: "tab-ring",
      intent: "activate",
    });
  });

  it("gives vertical-dominant drags to the list on a root tab", () => {
    expect(decideShellSwipe({ deltaX: 8, deltaY: 50 }, OPEN_GATE).intent).toBe("fail");
  });
});

describe("decideShellSwipe — 文件页内层段 pager (F29)", () => {
  // 单仲裁器原则：segment posture 在场 = 这条 Pan 是文件页的内层段手势，
  // 角色判给 files-segment；栈页/环的分支不参与（让位/接管是 RNGH 的事）。
  const seg = (index: number, count: number) => ({
    ...OPEN_GATE,
    stackInFront: true,
    segment: { index, count },
  });

  it("中段双向都判给 files-segment 且 activate（stackInFront 不再压住内滑）", () => {
    expect(decideShellSwipe({ deltaX: -20, deltaY: 0 }, seg(1, 3))).toEqual({
      role: "files-segment",
      intent: "activate",
    });
    expect(decideShellSwipe({ deltaX: 20, deltaY: 0 }, seg(1, 3))).toEqual({
      role: "files-segment",
      intent: "activate",
    });
  });

  it("边界外抛谓词经仲裁器落地：最左+右滑、最右+左滑 = fail（同流让位祖先面）", () => {
    expect(decideShellSwipe({ deltaX: 60, deltaY: 0 }, seg(0, 3))).toEqual({
      role: "files-segment",
      intent: "fail",
    });
    expect(decideShellSwipe({ deltaX: -60, deltaY: 0 }, seg(2, 3))).toEqual({
      role: "files-segment",
      intent: "fail",
    });
  });

  it("gates 先于内层：blocked（搜索态/换页中）与横滚豁免都让段手势哑火", () => {
    expect(decideShellSwipe({ deltaX: -20, deltaY: 0 }, { ...seg(1, 3), blocked: true })).toEqual({
      role: "files-segment",
      intent: "fail",
    });
    expect(
      decideShellSwipe({ deltaX: 20, deltaY: 0 }, { ...seg(1, 3), horizontalScrolled: true }),
    ).toEqual({ role: "files-segment", intent: "fail" });
  });

  it("灰段退化：count=1 双向 fail，role 仍是 files-segment（外抛由祖先面接住）", () => {
    expect(decideShellSwipe({ deltaX: -80, deltaY: 0 }, seg(0, 1)).role).toBe("files-segment");
    expect(decideShellSwipe({ deltaX: -80, deltaY: 0 }, seg(0, 1)).intent).toBe("fail");
    expect(decideShellSwipe({ deltaX: 80, deltaY: 0 }, seg(0, 1)).intent).toBe("fail");
  });

  it("posture 缺席 = 旧行为逐字不变（环/栈页两分支零回归）", () => {
    expect(
      decideShellSwipe({ deltaX: -40, deltaY: 0 }, { ...OPEN_GATE, stackInFront: true }),
    ).toEqual({
      role: "stack-back",
      intent: "fail",
    });
    expect(decideShellSwipe({ deltaX: -40, deltaY: 0 }, OPEN_GATE)).toEqual({
      role: "tab-ring",
      intent: "activate",
    });
  });
});

describe("decideShellSwipe — gates (互斥清单 + 声明性豁免)", () => {
  it("the blocked band kills both roles, whichever owns the front", () => {
    expect(decideShellSwipe({ deltaX: 40, deltaY: 0 }, { ...OPEN_GATE, blocked: true })).toEqual({
      role: "tab-ring",
      intent: "fail",
    });
    expect(
      decideShellSwipe(
        { deltaX: 40, deltaY: 0 },
        { stackInFront: true, blocked: true, horizontalScrolled: false },
      ),
    ).toEqual({ role: "stack-back", intent: "fail" });
  });

  it("a registered horizontal surface scrolled right keeps its own swipe (代码块反证)", () => {
    expect(
      decideShellSwipe({ deltaX: 40, deltaY: 0 }, { ...OPEN_GATE, horizontalScrolled: true }),
    ).toEqual({ role: "tab-ring", intent: "fail" });
    expect(
      decideShellSwipe(
        { deltaX: 40, deltaY: 0 },
        { stackInFront: true, blocked: false, horizontalScrolled: true },
      ),
    ).toEqual({ role: "stack-back", intent: "fail" });
  });
});

describe("isDetailGroupFrontmost", () => {
  it("is true only while the (detail) group is the focused root entry", () => {
    expect(
      isDetailGroupFrontmost({
        index: 1,
        routes: [{ name: SHELL_ROOT_ROUTE }, { name: DETAIL_ROOT_ROUTE }],
      }),
    ).toBe(true);
    expect(isDetailGroupFrontmost({ index: 0, routes: [{ name: SHELL_ROOT_ROUTE }] })).toBe(false);
    // 官方屏 push 在 detail 之上：焦点已离开组 → overlay 让位（胶囊边缘带接管）。
    expect(
      isDetailGroupFrontmost({
        index: 1,
        routes: [{ name: DETAIL_ROOT_ROUTE }, { name: "h/[serverId]" }],
      }),
    ).toBe(false);
  });

  it("fails closed without a navigation state", () => {
    expect(isDetailGroupFrontmost(undefined)).toBe(false);
  });
});
