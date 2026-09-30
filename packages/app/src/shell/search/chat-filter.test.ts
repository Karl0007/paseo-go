// C9 acceptance: 会话过滤纯函数单测 — 大小写不敏感 / 中英 CJK / 空串 / 别名命中 /
// 项目名命中 / 分组保持（置顶命中留在置顶组、空组消失、最近升顶隐头）。
import { describe, expect, it } from "vitest";
import type { ChatAgentInput, ChatSection } from "@/shell/chats/derive";
import { chatMatchesQuery, filterChatSections, type ChatSearchFields } from "./chat-filter";
import { normalizeSearchQuery } from "./query";

const FIELDS: ChatSearchFields = {
  alias: null,
  title: "Deploy the API",
  projectName: "c5-proj",
  activityLabel: "Running",
};

describe("normalizeSearchQuery", () => {
  it("trims and casefolds; CJK passes through", () => {
    expect(normalizeSearchQuery("  DePlOy ")).toBe("deploy");
    expect(normalizeSearchQuery("中文文档")).toBe("中文文档");
    expect(normalizeSearchQuery("   ")).toBe("");
  });
});

describe("chatMatchesQuery", () => {
  it("empty query matches everything (restore-on-clear contract)", () => {
    expect(chatMatchesQuery(FIELDS, "")).toBe(true);
    expect(
      chatMatchesQuery({ alias: null, title: null, projectName: null, activityLabel: null }, ""),
    ).toBe(true);
  });

  it("matches title case-insensitively (queries arrive normalised)", () => {
    expect(chatMatchesQuery(FIELDS, normalizeSearchQuery("DePlOy"))).toBe(true);
    expect(chatMatchesQuery(FIELDS, "deploy")).toBe(true);
    expect(chatMatchesQuery(FIELDS, "nope")).toBe(false);
  });

  it("matches the shell alias even when the title misses", () => {
    const fields = { ...FIELDS, alias: "生产发布" };
    expect(chatMatchesQuery(fields, "生产")).toBe(true);
    expect(chatMatchesQuery(fields, "发布")).toBe(true);
  });

  it("matches project name and the activity label", () => {
    expect(chatMatchesQuery(FIELDS, "c5-pro")).toBe(true);
    expect(chatMatchesQuery(FIELDS, "runn")).toBe(true);
  });

  it("null fields never match, and CJK is substring-matched", () => {
    const fields: ChatSearchFields = {
      alias: null,
      title: "中文文档审阅",
      projectName: null,
      activityLabel: null,
    };
    expect(chatMatchesQuery(fields, "文档")).toBe(true);
    expect(chatMatchesQuery(fields, "c5")).toBe(false);
  });
});

function agent(key: string, overrides: Partial<ChatAgentInput> = {}): ChatAgentInput {
  return {
    key,
    serverId: "host-a",
    lastActivityAt: 1,
    attentionTimestamp: null,
    bucket: "done",
    ...overrides,
  };
}

function section(init: {
  kind: ChatSection["kind"];
  serverId?: string;
  showHeader?: boolean;
  rows?: ChatSection["rows"];
}): ChatSection {
  return {
    kind: init.kind,
    serverId: init.serverId ?? null,
    showHeader: init.showHeader ?? true,
    rows: init.rows ?? [],
  };
}

describe("filterChatSections", () => {
  const haystack = new Map<string, ChatSearchFields>([
    ["p1", { alias: "重点", title: "Pinned one", projectName: "alpha", activityLabel: null }],
    ["r1", { alias: null, title: "Recent one", projectName: "beta", activityLabel: "Running" }],
    ["r2", { alias: null, title: "Other", projectName: "gamma", activityLabel: null }],
  ]);
  const match = (query: string) => {
    const normalized = normalizeSearchQuery(query);
    return (input: ChatAgentInput) => chatMatchesQuery(haystack.get(input.key)!, normalized);
  };
  it("keeps group membership: a 置顶 hit stays in the pinned section", () => {
    const sections = [
      section({ kind: "pinned", rows: [{ agent: agent("p1"), unread: false, dimmed: false }] }),
      section({ kind: "recent", rows: [{ agent: agent("r1"), unread: false, dimmed: false }] }),
    ];
    const out = filterChatSections(sections, match("重点"));
    expect(out.map((s) => s.kind)).toEqual(["pinned"]);
    expect(out[0]!.rows.map((r) => r.agent.key)).toEqual(["p1"]);
  });

  it("drops empty groups and filters rows inside a group", () => {
    const sections = [
      section({
        kind: "recent",
        rows: [
          { agent: agent("r1"), unread: false, dimmed: false },
          { agent: agent("r2"), unread: false, dimmed: false },
        ],
      }),
      section({
        // B4-ROW: 需要处理 is gone as a group; an offline-host group is the other
        // kind that must disappear when none of its rows match.
        kind: "offline",
        serverId: "host-c",
        rows: [{ agent: agent("p1"), unread: false, dimmed: true }],
      }),
    ];
    const out = filterChatSections(sections, match("beta"));
    expect(out.map((s) => s.kind)).toEqual(["recent"]);
    expect(out[0]!.rows.map((r) => r.agent.key)).toEqual(["r1"]);
  });

  it("re-applies the lone-最近 header rule after filtering", () => {
    const sections = [
      section({ kind: "pinned", rows: [{ agent: agent("p1"), unread: false, dimmed: false }] }),
      section({
        kind: "recent",
        showHeader: true,
        rows: [
          { agent: agent("r1"), unread: false, dimmed: false },
          { agent: agent("r2"), unread: false, dimmed: false },
        ],
      }),
    ];
    // pinned group survives → 最近 keeps its header
    expect(filterChatSections(sections, match("e"))[1]!.showHeader).toBe(true);
    // only 最近 survives → header hides, same rule as derive
    const lone = filterChatSections(sections, match("Recent one"));
    expect(lone.map((s) => s.kind)).toEqual(["recent"]);
    expect(lone[0]!.showHeader).toBe(false);
  });

  it("offline groups filter by the same fields", () => {
    const sections = [
      section({
        kind: "offline",
        serverId: "host-b",
        rows: [{ agent: agent("r1", { serverId: "host-b" }), unread: false, dimmed: true }],
      }),
    ];
    expect(filterChatSections(sections, match("nothere"))).toEqual([]);
    expect(filterChatSections(sections, match("runn")).map((s) => s.serverId)).toEqual(["host-b"]);
  });
});
