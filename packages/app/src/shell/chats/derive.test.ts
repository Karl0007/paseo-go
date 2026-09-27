// C2 acceptance: grouping/sorting/unread pure logic (边界: 空/离线/多 host/等待批准优先).
import { describe, expect, it } from "vitest";
import {
  chatLastEventAt,
  chatLastEventAtFromAgent,
  deriveChatSections,
  flattenChatSections,
  isChatUnread,
  showsUnreadDot,
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
    // C18: only attention stamps flag rows — `fresh` ran a newer step but never
    // completed one, so it stays read even with no watermark at all.
    const sections = derive({
      agents: [
        agent({ key: "read", attentionTimestamp: T0 }),
        agent({ key: "fresh", lastActivityAt: T0 + MINUTE }),
        agent({ key: "star", attentionTimestamp: T0 + MINUTE }),
      ],
      pinnedIds: ["star"],
      lastReadAt: { read: T0, star: T0 },
    });
    const byKey = new Map(sections.flatMap((s) => s.rows).map((r) => [r.agent.key, r.unread]));
    expect(byKey).toEqual(
      new Map([
        ["star", true],
        ["fresh", false],
        ["read", false],
      ]),
    );
  });
});

describe("isChatUnread (C18 completion gate)", () => {
  it("① activity advancing mid-run never flips the chat unread", () => {
    const running = agent({ key: "k", attentionTimestamp: null });
    expect(isChatUnread({ ...running, lastActivityAt: T0 + MINUTE }, T0)).toBe(false);
    expect(isChatUnread({ ...running, lastActivityAt: T0 + 10 * MINUTE }, T0)).toBe(false);
  });

  it("② attention(finished) newer than the watermark flips unread; equal is read", () => {
    expect(isChatUnread(agent({ key: "k", attentionTimestamp: T0 + MINUTE }), T0)).toBe(true);
    // Opening stamps the max watermark, and a completed chat's attention IS its last
    // event — so equal timestamps must read as seen (else the dot never clears).
    expect(isChatUnread(agent({ key: "k", lastActivityAt: T0, attentionTimestamp: T0 }), T0)).toBe(
      false,
    );
  });

  it("③ never-opened + attention present is unread", () => {
    expect(isChatUnread(agent({ key: "k", attentionTimestamp: T0 }), undefined)).toBe(true);
  });

  it("④ never-opened + no attention is read (imported / never completed)", () => {
    expect(isChatUnread(agent({ key: "k", lastActivityAt: T0 + MINUTE }), undefined)).toBe(false);
  });
});

describe("showsUnreadDot (C18 双点收敛)", () => {
  it("active buckets never show the dot — status light + bold title carry them", () => {
    for (const bucket of ["running", "needs_input", "failed"] as const) {
      expect(showsUnreadDot(bucket, 0)).toBe(false);
      expect(showsUnreadDot(bucket, 3)).toBe(false);
    }
  });

  it("idle buckets show the dot; a pending count hands the badge slot to the pill", () => {
    expect(showsUnreadDot("done", 0)).toBe(true);
    expect(showsUnreadDot("attention", 0)).toBe(true);
    expect(showsUnreadDot("done", 1)).toBe(false);
    expect(showsUnreadDot("attention", 2)).toBe(false);
  });
});

// R2-14: protocol date fields are bare z.string() (wire-compat rule), so a
// non-compliant host can deliver "not-a-date". getTime() on that is NaN, and
// NaN used to flow chatLastEventAtFromAgent → markRead → the int/nonnegative
// persist schema rejecting the envelope → validated-persist-storage dropping
// the WHOLE readState store. The family must never emit NaN.
describe("chatLastEventAt family — R2-14 untrusted protocol dates", () => {
  it("chatLastEventAtFromAgent returns null (not NaN) when every host date is garbage", () => {
    expect(chatLastEventAtFromAgent({ lastActivityAt: new Date("not-a-date") })).toBeNull();
    expect(
      chatLastEventAtFromAgent({
        lastActivityAt: new Date("not-a-date"),
        attentionTimestamp: new Date("also-garbage"),
      }),
    ).toBeNull();
  });

  it("one garbage field never poisons the trustworthy other", () => {
    expect(
      chatLastEventAtFromAgent({
        lastActivityAt: new Date("not-a-date"),
        attentionTimestamp: new Date(T0),
      }),
    ).toBe(T0);
    expect(
      chatLastEventAtFromAgent({
        lastActivityAt: new Date(T0),
        attentionTimestamp: new Date("not-a-date"),
      }),
    ).toBe(T0);
  });

  it("keeps the compliant max semantics untouched", () => {
    expect(
      chatLastEventAtFromAgent({
        lastActivityAt: new Date(T0 + MINUTE),
        attentionTimestamp: new Date(T0),
      }),
    ).toBe(T0 + MINUTE);
    expect(chatLastEventAtFromAgent({ lastActivityAt: new Date(T0) })).toBe(T0);
  });

  it("chatLastEventAt never returns NaN even when a caller fed the numbers through", () => {
    expect(chatLastEventAt(agent({ key: "k", lastActivityAt: Number.NaN }))).toBe(0);
    expect(chatLastEventAt(agent({ key: "k", attentionTimestamp: Number.NaN }))).toBe(T0);
    expect(
      chatLastEventAt(agent({ key: "k", lastActivityAt: Number.NaN, attentionTimestamp: T0 })),
    ).toBe(T0);
  });
});
