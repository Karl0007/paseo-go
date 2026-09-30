// B4-IMPORT 总线契约：one-shot 语义——意图在无人消费时保留（body 未挂载时发出
// 不丢），consume 一次即清空（后续回访不被旧意图覆写）；订阅者收到即时广播，
// 退订后不再被打扰。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeChatsFilterIntent,
  requestChatsFilter,
  subscribeChatsFilterIntent,
} from "./filter-request";

afterEach(() => {
  // 兜底清空：任何用例残留的 pending 都不许漏进下一个用例。
  consumeChatsFilterIntent();
});

describe("chats filter intent bus", () => {
  it("keeps the intent until consumed, then clears it", () => {
    requestChatsFilter("archived");
    expect(consumeChatsFilterIntent()).toBe("archived");
    expect(consumeChatsFilterIntent()).toBeNull();
  });

  it("notifies subscribers so a mounted body applies without polling", () => {
    const listener = vi.fn(() => consumeChatsFilterIntent());
    const off = subscribeChatsFilterIntent(listener);
    requestChatsFilter("active");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    requestChatsFilter("archived");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeChatsFilterIntent()).toBe("archived");
  });

  it("last request wins while nobody consumes", () => {
    requestChatsFilter("archived");
    requestChatsFilter("active");
    expect(consumeChatsFilterIntent()).toBe("active");
  });
});
