// C30 §4-8 stub contract: the rail emits on re-press of the live section; C31's
// list bodies subscribe. The listener set must deliver, survive unsubscribe,
// and never double-fire.
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitRailRetap, subscribeRailRetap } from "./rail-events";

describe("rail retap events", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const off of cleanups.splice(0)) off();
  });

  it("delivers the section to every listener until unsubscribed", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeRailRetap(a);
    cleanups.push(subscribeRailRetap(b));
    emitRailRetap("chats");
    expect(a).toHaveBeenCalledWith("chats");
    expect(b).toHaveBeenCalledWith("chats");
    a.mockClear();
    b.mockClear();
    offA();
    emitRailRetap("workspace");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("workspace");
  });
  it("emits into the void while no list body subscribes (C30 shipping state)", () => {
    expect(() => emitRailRetap("me")).not.toThrow();
  });
});
