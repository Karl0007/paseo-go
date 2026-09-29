// KI-9 acceptance: the crossfade decision table. The contract that keeps the
// device behaviour honest: exactly ONE pane targets opacity 1 (the active
// section), every other VISITED pane targets 0 (they stay mounted behind it —
// keep-alive), and unvisited sections never light up (a rail tap mounting a new
// body fades it in from its created-at-0 value; the table must not pre-light it).
import { describe, expect, it } from "vitest";
import { SECTION_FADE_MS, paneFadeTargets } from "./section-fade";

describe("paneFadeTargets", () => {
  it("lights only the active section on a switch", () => {
    expect(paneFadeTargets(["chats", "workspace"], "workspace")).toEqual({
      chats: 0,
      workspace: 1,
      me: 0,
    });
  });

  it("keeps unvisited sections dark", () => {
    expect(paneFadeTargets(["chats"], "chats")).toEqual({ chats: 1, workspace: 0, me: 0 });
    expect(paneFadeTargets([], "me")).toEqual({ chats: 0, workspace: 0, me: 0 });
  });

  it("stays a pure 0/1 table across every section pair", () => {
    const sections = ["chats", "workspace", "me"] as const;
    for (const active of sections) {
      const targets = paneFadeTargets(sections, active);
      const lit = sections.filter((s) => targets[s] === 1);
      expect(lit).toEqual([active]);
    }
  });

  it("pins the shared fade beat (compact FadeSpec is 150ms natively)", () => {
    expect(SECTION_FADE_MS).toBe(150);
  });
});
