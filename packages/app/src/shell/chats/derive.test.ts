// C2 acceptance: grouping/sorting/unread pure logic (边界: 空/离线/多 host/等待批准优先).
import { describe, expect, it } from "vitest";
import {
  deriveChatSections,
  flattenChatSections,
  isChatUnread,
  type ChatSection,
  type ChatAgentInput,
  type DeriveChatSectionsInput,
} from "./derive";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function agent(overrides: Partial<ChatAgentInput> & Pick<ChatAgentInput, "key">): ChatAgentInput {
  return {
    serverId: "host-a",
    lastActivityAt: T0,
    attentionTimestamp: null,
    bucket: "done",
    ...overrides,
  };
}

function derive(input: Partial<DeriveChatSectionsInput<ChatAgentInput>> = {}) {
  return deriveChatSections({
    agents: [],
    pinnedIds: [],
    archivedIds: [],
    lastReadAt: {},
    hostIds: ["host-a"],
    hostStatuses: new Map([["host-a", "online" as const]]),
    ...input,
  });
}

const kinds = (sections: ChatSection[]) =>
  sections.map((section) => `${section.kind}${section.serverId ? `:${section.serverId}` : ""}`);

describe("deriveChatSections", () => {
  it("empty input yields no sections", () => {
    expect(derive()).toEqual([]);
    expect(flattenChatSections(derive())).toEqual([]);
  });

  it("lone recent group hides its header; a second group makes it show", () => {
    const lone = derive({ agents: [agent({ key: "a" })] });
    expect(kinds(lone)).toEqual(["recent"]);
    expect(lone[0]!.showHeader).toBe(false);

    const withPinned = derive({
      agents: [agent({ key: "a" }), agent({ key: "b" })],
      pinnedIds: ["b"],
    });
    expect(kinds(withPinned)).toEqual(["pinned", "recent"]);
    expect(withPinned[1]!.showHeader).toBe(true);
  });

  it("groups pinned → needs_attention → recent in that order", () => {
    const sections = derive({
      agents: [
        agent({ key: "plain", lastActivityAt: T0 + 10 * MINUTE }),
        agent({ key: "waiting", bucket: "needs_input", attentionTimestamp: T0 + MINUTE }),
        agent({ key: "star", bucket: "running", lastActivityAt: T0 + 5 * MINUTE }),
      ],
      pinnedIds: ["star"],
    });
    expect(kinds(sections)).toEqual(["pinned", "needs_attention", "recent"]);
    expect(sections.map((s) => s.rows[0]!.agent.key)).toEqual(["star", "waiting", "plain"]);
  });

  it("pinned rows follow the pins store order, stale pin ids are ignored", () => {
    const sections = derive({
      agents: [agent({ key: "first" }), agent({ key: "second" }), agent({ key: "third" })],
      pinnedIds: ["third", "gone", "first"],
    });
    expect(kinds(sections)).toEqual(["pinned", "recent"]);
    expect(sections[0]!.rows.map((r) => r.agent.key)).toEqual(["third", "first"]);
    expect(sections[1]!.rows.map((r) => r.agent.key)).toEqual(["second"]);
  });

  it("needs_attention sorts by attention request newest first, oldest attention still outranks fresh activity", () => {
    const sections = derive({
      agents: [
        agent({ key: "busy", bucket: "running", lastActivityAt: T0 + 100 * MINUTE }),
        agent({
          key: "waiting-old",
          bucket: "needs_input",
          attentionTimestamp: T0,
          lastActivityAt: T0,
        }),
        agent({
          key: "waiting-new",
          bucket: "needs_input",
          attentionTimestamp: T0 + 2 * MINUTE,
          lastActivityAt: T0 + MINUTE,
        }),
      ],
    });
    expect(kinds(sections)).toEqual(["needs_attention", "recent"]);
    expect(sections[0]!.rows.map((r) => r.agent.key)).toEqual(["waiting-new", "waiting-old"]);
  });

  it("recent sorts newest event first; attention stamp counts as the event", () => {
    const sections = derive({
      agents: [
        agent({ key: "old", lastActivityAt: T0 }),
        agent({
          key: "attentive",
          lastActivityAt: T0,
          attentionTimestamp: T0 + 9 * MINUTE,
          bucket: "attention",
        }),
        agent({ key: "new", lastActivityAt: T0 + 5 * MINUTE }),
      ],
    });
    expect(sections[0]!.rows.map((r) => r.agent.key)).toEqual(["attentive", "new", "old"]);
  });

  it("multi-host: online hosts merge flat, offline hosts get one greyed group each in host order", () => {
    const sections = derive({
      agents: [
        agent({ key: "a1", serverId: "host-a" }),
        agent({ key: "b1", serverId: "host-b", lastActivityAt: T0 + MINUTE }),
        agent({ key: "c-off", serverId: "host-c", lastActivityAt: T0 + 3 * MINUTE }),
        agent({ key: "a2", serverId: "host-a", lastActivityAt: T0 + 2 * MINUTE }),
        agent({ key: "c-off-old", serverId: "host-c", lastActivityAt: T0 }),
      ],
      hostIds: ["host-a", "host-b", "host-c"],
      hostStatuses: new Map([
        ["host-a", "online"],
        ["host-b", "online"],
        ["host-c", "offline"],
      ]),
    });
    expect(kinds(sections)).toEqual(["recent", "offline:host-c"]);
    expect(sections[0]!.rows.map((r) => r.agent.key)).toEqual(["a2", "b1", "a1"]);
    expect(sections[0]!.rows.every((r) => !r.dimmed)).toBe(true);
    expect(sections[1]!.rows.map((r) => r.agent.key)).toEqual(["c-off", "c-off-old"]);
    expect(sections[1]!.rows.every((r) => r.dimmed)).toBe(true);
  });

  it("offline rows stay offline even when pinned or waiting approval", () => {
    const sections = derive({
      agents: [
        agent({
          key: "pinned-off",
          serverId: "host-c",
          bucket: "needs_input",
          attentionTimestamp: T0,
        }),
      ],
      pinnedIds: ["pinned-off"],
      hostIds: ["host-a", "host-c"],
      hostStatuses: new Map([
        ["host-a", "online"],
        ["host-c", "connecting"],
      ]),
    });
    expect(kinds(sections)).toEqual(["offline:host-c"]);
  });

  it("archived rows disappear from every group", () => {
    const sections = derive({
      agents: [
        agent({ key: "keep" }),
        agent({ key: "drop", bucket: "needs_input", attentionTimestamp: T0 }),
      ],
      archivedIds: ["drop"],
    });
    expect(kinds(sections)).toEqual(["recent"]);
    expect(sections[0]!.rows.map((r) => r.agent.key)).toEqual(["keep"]);
  });

  it("unread flags land on rows; a pinned row is unread too", () => {
    const sections = derive({
      agents: [
        agent({ key: "read", lastActivityAt: T0 }),
        agent({ key: "fresh", lastActivityAt: T0 + MINUTE }),
        agent({ key: "star", lastActivityAt: T0 }),
      ],
      pinnedIds: ["star"],
      lastReadAt: { read: T0, star: T0 + MINUTE },
    });
    const byKey = new Map(sections.flatMap((s) => s.rows).map((r) => [r.agent.key, r.unread]));
    expect(byKey).toEqual(
      new Map([
        ["star", false],
        ["fresh", true],
        ["read", false],
      ]),
    );
  });
});

describe("isChatUnread", () => {
  it("never-opened chats are unread; equal timestamps are read", () => {
    expect(isChatUnread(agent({ key: "k" }), undefined)).toBe(true);
    expect(isChatUnread(agent({ key: "k", lastActivityAt: T0 }), T0)).toBe(false);
    expect(isChatUnread(agent({ key: "k", lastActivityAt: T0 }), T0 - 1)).toBe(true);
  });

  it("an attention request newer than the read stamp re-flags the chat unread", () => {
    expect(
      isChatUnread(agent({ key: "k", lastActivityAt: T0, attentionTimestamp: T0 + MINUTE }), T0),
    ).toBe(true);
  });
});
