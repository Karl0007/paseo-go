// @vitest-environment jsdom
// R4-17（裁定 12「高亮该行」子句）消费端契约：跳转意图到达 = ①filter 经调用方
// 唯一的 setFilter 切换（不另立页状态）②带 highlightKey 时行键进一次性高亮态
// 且 nonce +1（body 把 nonce 折进列表 key=免 ref 的归顶原语）③1.2s 后高亮自熄、
// nonce 保持（熄灭只是行样式，不得再触发重挂）。不带 key 的意图=纯切页，高亮态
// 与 nonce 都不动。挂载时兑现 pending（body 未挂载时发出的意图不丢）。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeChatsFilterIntent, requestChatsFilter } from "./filter-request";
import { CHATS_JUMP_HIGHLIGHT_MS, useChatsFilterJump } from "./use-chats-filter-jump";

beforeEach(() => {
  vi.useFakeTimers();
  consumeChatsFilterIntent();
});

afterEach(() => {
  // 显式卸载（仓内 .test.tsx 惯例）：总线是模块级 Set，泄漏的订阅会先一步
  // consume 掉下一个用例的意图（consume-once 语义），用例间必须零残留订阅。
  cleanup();
  consumeChatsFilterIntent();
  vi.useRealTimers();
});

describe("useChatsFilterJump (R4-17 consumption)", () => {
  it("applies a pending intent on mount: filter switches, row keys in, nonce bumps", () => {
    requestChatsFilter({ filter: "archived", highlightKey: "srv-1:agent-9" });
    const applyFilter = vi.fn();
    const { result } = renderHook(() => useChatsFilterJump(applyFilter));
    expect(applyFilter).toHaveBeenCalledWith("archived");
    expect(result.current.highlightKey).toBe("srv-1:agent-9");
    expect(result.current.nonce).toBe(1);
  });

  it("live intent switches the page and highlights without a stale pending", () => {
    const applyFilter = vi.fn();
    const { result } = renderHook(() => useChatsFilterJump(applyFilter));
    expect(result.current).toEqual({ highlightKey: null, nonce: 0 });
    act(() => requestChatsFilter({ filter: "archived", highlightKey: "s:a" }));
    expect(applyFilter).toHaveBeenCalledWith("archived");
    expect(result.current).toEqual({ highlightKey: "s:a", nonce: 1 });
  });

  it("a filter-only intent never touches the highlight or the remount nonce", () => {
    const applyFilter = vi.fn();
    const { result } = renderHook(() => useChatsFilterJump(applyFilter));
    act(() => requestChatsFilter({ filter: "active" }));
    expect(applyFilter).toHaveBeenCalledWith("active");
    expect(result.current).toEqual({ highlightKey: null, nonce: 0 });
  });

  it("the highlight is one-shot: it self-clears after the pulse, the nonce survives", () => {
    const applyFilter = vi.fn();
    const { result } = renderHook(() => useChatsFilterJump(applyFilter));
    act(() => requestChatsFilter({ filter: "archived", highlightKey: "s:a" }));
    act(() => {
      vi.advanceTimersByTime(CHATS_JUMP_HIGHLIGHT_MS - 1);
    });
    expect(result.current.highlightKey).toBe("s:a");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // 熄灭只动样式位：nonce 原样=列表不再重挂（B4-REGRESS 重挂面纪律）。
    expect(result.current).toEqual({ highlightKey: null, nonce: 1 });
  });

  it("a second jump re-arms the pulse on the same row key", () => {
    const applyFilter = vi.fn();
    const { result } = renderHook(() => useChatsFilterJump(applyFilter));
    act(() => requestChatsFilter({ filter: "archived", highlightKey: "s:a" }));
    act(() => {
      vi.advanceTimersByTime(CHATS_JUMP_HIGHLIGHT_MS - 100);
    });
    act(() => requestChatsFilter({ filter: "archived", highlightKey: "s:a" }));
    expect(result.current.nonce).toBe(2);
    act(() => {
      vi.advanceTimersByTime(CHATS_JUMP_HIGHLIGHT_MS - 100);
    });
    // 旧脉冲到点不得吞掉新一次的高亮（timer 重挂断言）。
    expect(result.current.highlightKey).toBe("s:a");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.highlightKey).toBeNull();
  });

  it("unmount unsubscribes: a later intent stays pending for the next consumer", () => {
    const applyFilter = vi.fn();
    const { unmount } = renderHook(() => useChatsFilterJump(applyFilter));
    unmount();
    act(() => requestChatsFilter({ filter: "archived", highlightKey: "s:a" }));
    // 退订断言（cleanup 的 off()）：死订阅既不许接活，也不许偷 consume——
    // 意图必须原样躺在总线上等下一个挂载的 body（consume-once 的另一半）。
    expect(applyFilter).not.toHaveBeenCalled();
    expect(consumeChatsFilterIntent()).toEqual({ filter: "archived", highlightKey: "s:a" });
  });
});
