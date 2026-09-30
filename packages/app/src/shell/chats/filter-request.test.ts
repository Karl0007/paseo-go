// B4-IMPORT 总线契约：one-shot 语义——意图在无人消费时保留（body 未挂载时发出
// 不丢），consume 一次即清空（后续回访不被旧意图覆写）；订阅者收到即时广播，
// 退订后不再被打扰。R4-17（裁定 12「高亮该行」子句）起意图是对象：filter + 可选
// highlightKey（`serverId:agentId` 行键），总线原样搬运、不做解释——消费语义在
// use-chats-filter-jump（其测钉兑现端）。
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
    requestChatsFilter({ filter: "archived" });
    expect(consumeChatsFilterIntent()).toEqual({ filter: "archived" });
    expect(consumeChatsFilterIntent()).toBeNull();
  });

  it("carries the highlight row key through verbatim (R4-17 intent shape)", () => {
    requestChatsFilter({ filter: "archived", highlightKey: "srv-1:agent-9" });
    expect(consumeChatsFilterIntent()).toEqual({
      filter: "archived",
      highlightKey: "srv-1:agent-9",
    });
  });

  it("notifies subscribers so a mounted body applies without polling", () => {
    const listener = vi.fn(() => consumeChatsFilterIntent());
    const off = subscribeChatsFilterIntent(listener);
    requestChatsFilter({ filter: "active" });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    requestChatsFilter({ filter: "archived" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeChatsFilterIntent()).toEqual({ filter: "archived" });
  });

  it("last request wins while nobody consumes", () => {
    requestChatsFilter({ filter: "archived", highlightKey: "srv-1:agent-9" });
    requestChatsFilter({ filter: "active" });
    expect(consumeChatsFilterIntent()).toEqual({ filter: "active" });
  });
});
