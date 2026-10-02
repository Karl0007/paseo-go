// B8-FILESWIP (F29) acceptance — the LINEAR segment machine pinned without a
// screen. The card's demanded properties, in the card's order:
//   段切换 — 中段双向 activate、目标 = 线性邻段（右滑回左邻、左滑进右邻）；
//   边界外抛谓词 — 最左 + 手指右滑 = FAIL（让位祖先面：栈页 pop / tab 主环），
//     最右 + 手指左滑 = FAIL；绝不回卷（first+right 永远不是 last 段——用户
//     追加确认的冻结口径，编排者钉死的必红断言）；
//   灰段退化 — 非 git checkout count=1：任何方向都无邻，内滑全 FAIL 只剩外抛；
//   释放判定 — 环同款阈值（¼ 列宽 / 500dp/s / 反向尾速取消），目标算术线性，
//     越界 = snap-back（第二道不回卷闸）。
import { describe, expect, it } from "vitest";
import {
  decideFilesSegmentRelease,
  filesSegmentIndexForTab,
  filesSegmentNeighbor,
  filesSegmentTabForIndex,
  resolveFilesSegmentSwipeIntent,
} from "./files-segment";

/** git checkout 的完整三段姿态。 */
const FULL = { index: 1, count: 3 };

describe("files-segment 映射 + 线性邻段", () => {
  it("段名 ↔ 序号按 文件|变更|提交 的线性顺序", () => {
    expect(filesSegmentIndexForTab("files")).toBe(0);
    expect(filesSegmentIndexForTab("diff")).toBe(1);
    expect(filesSegmentIndexForTab("git")).toBe(2);
    expect(filesSegmentTabForIndex(0)).toBe("files");
    expect(filesSegmentTabForIndex(2)).toBe("git");
    expect(filesSegmentTabForIndex(3)).toBeNull();
    expect(filesSegmentTabForIndex(-1)).toBeNull();
  });

  it("邻段线性：中段双向有邻，两端各缺一侧", () => {
    expect(filesSegmentNeighbor(1, "forward", 3)).toBe(2);
    expect(filesSegmentNeighbor(1, "back", 3)).toBe(0);
    expect(filesSegmentNeighbor(0, "forward", 3)).toBe(1);
    expect(filesSegmentNeighbor(0, "back", 3)).toBeNull();
    expect(filesSegmentNeighbor(2, "back", 3)).toBe(1);
    expect(filesSegmentNeighbor(2, "forward", 3)).toBeNull();
  });

  it("绝不回卷（F29 冻结口径）：首段后退 ≠ 末段，末段前进 ≠ 首段", () => {
    expect(filesSegmentNeighbor(0, "back", 3), "首段+右滑必须外抛而非跳末段").toBeNull();
    expect(filesSegmentNeighbor(2, "forward", 3), "末段+左滑必须外抛/失败而非跳首段").toBeNull();
  });

  it("灰段退化：非 git count=1，任何方向都无邻", () => {
    expect(filesSegmentNeighbor(0, "forward", 1)).toBeNull();
    expect(filesSegmentNeighbor(0, "back", 1)).toBeNull();
  });
});

describe("resolveFilesSegmentSwipeIntent — 方向锁 + 边界外抛谓词", () => {
  it("垂直主导逃逸给面板滚动体（环同款 10dp 判据）", () => {
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 18, deltaY: 40 }, FULL)).toBe("fail");
  });

  it("水平行程未过 16dp slop 保持 wait", () => {
    expect(resolveFilesSegmentSwipeIntent({ deltaX: -15, deltaY: 0 }, FULL)).toBe("wait");
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 15, deltaY: 0 }, FULL)).toBe("wait");
  });

  it("中段双向都接管：左滑进右邻、右滑回左邻", () => {
    expect(resolveFilesSegmentSwipeIntent({ deltaX: -16, deltaY: 0 }, FULL)).toBe("activate");
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 16, deltaY: 0 }, FULL)).toBe("activate");
  });

  it("最左「文件」+ 手指右滑 = FAIL 外抛（栈页让位返回 / tab 让位主环），左滑照常换段", () => {
    const first = { index: 0, count: 3 };
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 60, deltaY: 2 }, first)).toBe("fail");
    expect(resolveFilesSegmentSwipeIntent({ deltaX: -60, deltaY: 2 }, first)).toBe("activate");
  });

  it("最右「提交」+ 手指左滑 = FAIL 外抛（tab 让位主环；栈页祖先面本就恒 FAIL），右滑照常回退", () => {
    const last = { index: 2, count: 3 };
    expect(resolveFilesSegmentSwipeIntent({ deltaX: -60, deltaY: 2 }, last)).toBe("fail");
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 60, deltaY: 2 }, last)).toBe("activate");
  });

  it("first segment + right-swipe → cascade/back，永不 wrap 到 last（编排者钉死的必红断言）", () => {
    // 右滑在最左段的唯一合法解读 = 外抛（intent fail → 祖先面接管同一触摸流）。
    // 若算术哪天改成环（wrap），这里会先红。
    expect(resolveFilesSegmentSwipeIntent({ deltaX: -0, deltaY: 0 }, { index: 0, count: 3 })).toBe(
      "wait",
    );
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 300, deltaY: 0 }, { index: 0, count: 3 })).toBe(
      "fail",
    );
  });

  it("灰段退化：count=1 时双向都 FAIL，只剩外抛", () => {
    const gray = { index: 0, count: 1 };
    expect(resolveFilesSegmentSwipeIntent({ deltaX: -80, deltaY: 0 }, gray)).toBe("fail");
    expect(resolveFilesSegmentSwipeIntent({ deltaX: 80, deltaY: 0 }, gray)).toBe("fail");
  });
});

describe("decideFilesSegmentRelease — 环同款阈值，线性目标", () => {
  const WIDTH = 300;

  it("行程过 ¼ 列宽换段：左滑进右邻（出场墙 -width），右滑回左邻（+width）", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: -75,
        velocityX: 0,
        posture: FULL,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "switch", direction: "forward", target: 2, exitEdge: -WIDTH });
    expect(
      decideFilesSegmentRelease({
        translationX: 75,
        velocityX: 0,
        posture: FULL,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "switch", direction: "back", target: 0, exitEdge: WIDTH });
  });

  it("行程不足且尾速不足 = snap-back", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: -74,
        velocityX: 0,
        posture: FULL,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("尾速过 500dp/s 哪怕行程不足也换段；零位移的纯甩动由尾速定方向", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: -10,
        velocityX: -600,
        posture: FULL,
        widthDp: WIDTH,
      }),
    ).toMatchObject({ kind: "switch", direction: "forward", target: 2 });
    expect(
      decideFilesSegmentRelease({
        translationX: 0,
        velocityX: -600,
        posture: FULL,
        widthDp: WIDTH,
      }),
    ).toMatchObject({ kind: "switch", direction: "forward", target: 2 });
  });

  it("反向尾速（手指收回出发侧）无论行程都取消换段", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: -200,
        velocityX: 600,
        posture: FULL,
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("第二道不回卷闸：边界姿态下即使手势错激活，释放也只 snap-back 不跳对侧段", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: 200,
        velocityX: 0,
        posture: { index: 0, count: 3 },
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
    expect(
      decideFilesSegmentRelease({
        translationX: -200,
        velocityX: 0,
        posture: { index: 2, count: 3 },
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("灰段 count=1：任何释放都 snap-back（无内滑）", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: -200,
        velocityX: -600,
        posture: { index: 0, count: 1 },
        widthDp: WIDTH,
      }),
    ).toEqual({ kind: "snap-back" });
  });

  it("未测量的列宽（widthDp<=0）不换段", () => {
    expect(
      decideFilesSegmentRelease({
        translationX: -200,
        velocityX: 0,
        posture: FULL,
        widthDp: 0,
      }),
    ).toEqual({ kind: "snap-back" });
  });
});
