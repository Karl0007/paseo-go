// @vitest-environment jsdom
// C33 acceptance: the rename screen's testable half. 保存 must hand the RAW field
// value to shellAgentActions.rename (its trim/blank-clears semantics are pinned in
// shellAgentActions.test.ts — the screen must not re-implement or pre-filter them)
// and leave; 取消/返回 must leave WITHOUT touching the store. Plus the params→target
// resolver the screen gates its whole body on.
import { describe, expect, it, vi } from "vitest";

// The pure exports need no surface; mock what the screen module pulls in around
// them (the global expo-router double from vitest.setup stays in place — KI-9's
// detailBack runs through it, no @react-navigation surface left on this screen).
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/text-input", () => ({ EditingTextInput: () => null }));

import { createRenameScreenHandlers, resolveRenameTarget } from "./rename";

const target = { key: "s1:a1", serverId: "s1", agentId: "a1" };

describe("resolveRenameTarget", () => {
  it("builds the pins-store key from the raw ids", () => {
    expect(resolveRenameTarget({ serverId: ".dev/paseo-home@h:6767", agentId: "a/1" })).toEqual({
      key: ".dev/paseo-home@h:6767:a/1",
      serverId: ".dev/paseo-home@h:6767",
      agentId: "a/1",
    });
  });

  it("yields null when either id is missing", () => {
    expect(resolveRenameTarget({ serverId: "s1" })).toBeNull();
    expect(resolveRenameTarget({ agentId: "a1" })).toBeNull();
    expect(resolveRenameTarget({})).toBeNull();
  });

  it("takes the first value of repeated params", () => {
    expect(resolveRenameTarget({ serverId: ["s1", "s2"], agentId: ["a1"] })).toEqual(target);
  });
});

describe("createRenameScreenHandlers", () => {
  it("保存 passes the raw value through and leaves", () => {
    const rename = vi.fn();
    const goBack = vi.fn();
    createRenameScreenHandlers({ target, rename, goBack }).save("  新名字  ");
    expect(rename).toHaveBeenCalledWith(target, "  新名字  ");
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("空提交 forwards the empty string — clearing is the action layer's contract", () => {
    const rename = vi.fn();
    const goBack = vi.fn();
    createRenameScreenHandlers({ target, rename, goBack }).save("");
    expect(rename).toHaveBeenCalledWith(target, "");
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("取消 leaves without touching rename", () => {
    const rename = vi.fn();
    const goBack = vi.fn();
    createRenameScreenHandlers({ target, rename, goBack }).cancel();
    expect(rename).not.toHaveBeenCalled();
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
