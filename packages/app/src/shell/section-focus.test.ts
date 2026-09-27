// C31 section-focus bus contract: it is the transport for the C18 双拍 return-stamp
// (the body's opener.onFocus). The invariants that matter: per-section delivery (a
// 对话 focus must never beat the 工作区 body — cross-talk would clear the other
// screen's pending visit), delivery until unsubscribe, and emitting into the void
// (official IA / full-bleed: no body subscribed) must be harmless.
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitSectionFocus, subscribeSectionFocus } from "./section-focus";

describe("section focus beats", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const off of cleanups.splice(0)) off();
  });

  it("delivers only to the emitting section's listeners, until unsubscribed", () => {
    const chats = vi.fn();
    const workspace = vi.fn();
    const offChats = subscribeSectionFocus("chats", chats);
    cleanups.push(subscribeSectionFocus("workspace", workspace));

    emitSectionFocus("chats");
    expect(chats).toHaveBeenCalledTimes(1);
    expect(workspace).not.toHaveBeenCalled();

    offChats();
    emitSectionFocus("chats");
    expect(chats).toHaveBeenCalledTimes(1); // no fire after unsubscribe
    emitSectionFocus("workspace");
    expect(workspace).toHaveBeenCalledTimes(1);
  });

  it("emits into the void while no body subscribes (shell-off / full-bleed)", () => {
    expect(() => emitSectionFocus("me")).not.toThrow();
  });
});
