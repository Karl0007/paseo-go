// F3 regression: the (shell)/_layout effect records the focused tab from the ROOT
// stack state — the focused route there is the `(shell)` group, whose own `.name`
// is never a tab. The tab name lives in the group's nested navigator state. Pre-fix,
// lastFocusedTab stayed null forever (theme-remount position and memory-first
// dispatch both dead).
import { describe, expect, it } from "vitest";
import { focusedShellTab, type NavStateLike } from "./focused-tab";

function rootState(tabIndex: number): NavStateLike {
  return {
    index: 0,
    routes: [
      {
        name: "(shell)",
        state: {
          index: tabIndex,
          routes: [{ name: "chats" }, { name: "workspace" }, { name: "me" }],
        },
      },
    ],
  };
}

describe("focusedShellTab", () => {
  it("reads the nested tab name through the (shell) group", () => {
    expect(focusedShellTab(rootState(0))).toBe("chats");
    expect(focusedShellTab(rootState(1))).toBe("workspace");
    expect(focusedShellTab(rootState(2))).toBe("me");
  });

  it("returns null while a hidden push owns the root stack (not a tab)", () => {
    expect(
      focusedShellTab({
        index: 1,
        routes: [rootState(0).routes[0], { name: "(detail)/preview" }],
      }),
    ).toBeNull();
  });

  it("returns null for an empty or root-level state", () => {
    expect(focusedShellTab(undefined)).toBeNull();
    expect(focusedShellTab({ index: 0, routes: [{ name: "welcome" }] })).toBeNull();
  });
});
