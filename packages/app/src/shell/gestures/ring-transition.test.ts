// B8-SWIPE acceptance (F26 跨 tab 交棒): the transition bus's contract, pinned
// without screens — an armed entrance belongs ONLY to its target section's focus
// beat (a beat for another section must not swallow it), consumption is once,
// and the frontmost stream dedupes so unrelated navigation churn can never
// interrupt a playing entrance or fire a stale reset.
import { describe, expect, it } from "vitest";
import {
  armRingTransition,
  consumeRingTransitionForSection,
  getShellFrontmostSection,
  setShellFrontmostSection,
  subscribeShellFrontmost,
} from "./ring-transition";

describe("pending ring transition", () => {
  it("hands the entrance to the target section's beat, once", () => {
    armRingTransition({ target: 2, direction: "forward" });
    expect(consumeRingTransitionForSection("workspace")).toEqual({
      target: 2,
      direction: "forward",
    });
    expect(consumeRingTransitionForSection("workspace")).toBeNull();
  });

  it("a foreign section's beat does not swallow it (chats 的拍不动 工作区 的进场)", () => {
    armRingTransition({ target: 1, direction: "back" });
    expect(consumeRingTransitionForSection("workspace")).toBeNull();
    expect(consumeRingTransitionForSection("me")).toBeNull();
    expect(consumeRingTransitionForSection("chats")).toEqual({ target: 1, direction: "back" });
  });

  it("a fresh arm replaces the stale one — one ring turn at a time", () => {
    armRingTransition({ target: 3, direction: "forward" });
    armRingTransition({ target: 0, direction: "back" });
    expect(consumeRingTransitionForSection("chats")).toEqual({ target: 0, direction: "back" });
    expect(consumeRingTransitionForSection("me")).toBeNull();
  });

  it("both chats slots belong to the chats section's beat (环内 0↔1 也走同一条消费)", () => {
    armRingTransition({ target: 1, direction: "forward" });
    expect(consumeRingTransitionForSection("chats")?.target).toBe(1);
  });
});

describe("frontmost bus", () => {
  it("notifies subscribers only when the front actually moved", () => {
    const seen: (string | null)[] = [];
    const off = subscribeShellFrontmost((section) => seen.push(section));
    setShellFrontmostSection("chats");
    setShellFrontmostSection("chats"); // churn: same front, no beat
    setShellFrontmostSection(null); // (detail)/official push on top
    setShellFrontmostSection("chats"); // pop back
    off();
    setShellFrontmostSection("me"); // after unsubscribe: silent
    expect(seen).toEqual(["chats", null, "chats"]);
  });

  it("exposes the current front for the mount-time catch-up beat", () => {
    setShellFrontmostSection("workspace");
    expect(getShellFrontmostSection()).toBe("workspace");
    setShellFrontmostSection(null);
    expect(getShellFrontmostSection()).toBeNull();
  });
});
