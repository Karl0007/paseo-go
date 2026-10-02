// B8-SWIPE (F27 声明性豁免): the stack-back gate composes per-surface claims by
// union — each screen releases only its own key (effect cleanup), the merged
// answer is what the overlay reads, and listeners fire only on real changes so
// the overlay never re-renders on a redundant declaration.
import { describe, expect, it, vi } from "vitest";
import {
  isStackBackBlocked,
  setStackBackBlocked,
  subscribeStackBackBlocked,
} from "./stack-back-gate";

describe("stack-back gate", () => {
  it("unions keys and releases only the caller's own", () => {
    setStackBackBlocked("import", true);
    setStackBackBlocked("files-search", true);
    expect(isStackBackBlocked()).toBe(true);
    setStackBackBlocked("import", false);
    expect(isStackBackBlocked()).toBe(true); // files 的搜索还在
    setStackBackBlocked("files-search", false);
    expect(isStackBackBlocked()).toBe(false);
  });

  it("is idempotent and notifies only on change", () => {
    const listener = vi.fn();
    const off = subscribeStackBackBlocked(listener);
    setStackBackBlocked("a", true);
    setStackBackBlocked("a", true);
    expect(listener).toHaveBeenCalledTimes(1);
    setStackBackBlocked("a", false);
    setStackBackBlocked("a", false);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    setStackBackBlocked("a", true);
    expect(listener).toHaveBeenCalledTimes(2);
    setStackBackBlocked("a", false);
  });
});
