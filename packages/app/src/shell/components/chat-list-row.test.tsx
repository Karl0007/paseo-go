/**
 * @vitest-environment jsdom
 */
// B6-TITLE (batch-6 F18 / D21) acceptance — the row's title line has exactly two
// sources: the shell rename (alias) and the `项目(worktree)` default. `agent.title`
// is NOT one of them: the daemon stamps it at birth with the first prompt truncated
// to 60 chars (`deriveInitialAgentTitle`), so feeding it in as the 备注 made every
// never-renamed session read as a prompt excerpt instead of the F12 default format.
// The rename side of the chain (rename screen, menu title, delete confirm) is the
// pins store, so the test seeds the REAL store instead of mocking it.
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityColor } from "@/styles/identity-colors";
import { projectAvatarFor } from "@/shell/chats/project-avatar";

vi.mock("react-i18next", () => ({
  // Echo t: the row's title is built from plain strings; only the 占位 fallback is a
  // locale key, and pinning it by key is exactly as strong as pinning a word.
  // `i18n` feeds the row's clock formatter (useWechatTimeLabel reads the locale).
  useTranslation: () => ({
    t: (key: string, options?: { n?: number }) =>
      options?.n !== undefined ? `${key}:${options.n}` : key,
    i18n: { language: "zh-CN", resolvedLanguage: "zh-CN" },
  }),
  // Pulled in by the app's i18n bootstrap, which the row's transitive imports load.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
// Partial: the official primitives the row transitively imports build animations from
// reanimated at module scope (Keyframe, Easing, …). Keep every real export and swap
// only the animated container for a plain host element.
interface ReanimatedModule {
  default: Record<string, unknown>;
  [key: string]: unknown;
}
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<ReanimatedModule>();
  return {
    ...actual,
    default: { ...actual.default, View: "animated-view" },
  };
});
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
vi.mock("@/shell/components/use-shell-row-drag-menu", () => ({
  useShellRowDragMenu: () => ({
    handlePressIn: vi.fn(),
    handleTouchMove: vi.fn(),
    handlePressOut: vi.fn(),
  }),
}));

import {
  ChatListRow,
  SLOT_CHIP_DP,
  TITLE_LINE_BUDGET_DP,
  TITLE_LINE_CHROME_DP,
  titleLineFloorWidthDp,
  titleLineWidthDp,
  type ShellChatAgent,
} from "@/shell/components/chat-list-row";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import type { ChatRow } from "@/shell/chats/derive";
import type { ShellAgentActions } from "@/shell/shellAgentActions";

const KEY = "host-1:agent-1";
/** The daemon's provisional title: the user's first prompt, truncated at birth. */
const PROVISIONAL_TITLE = "看一下当前工程，帮我把登录修好";

function agentFixture(overrides: Record<string, unknown> = {}): ShellChatAgent {
  return {
    key: KEY,
    serverId: "host-1",
    lastActivityAt: Date.now(),
    attentionTimestamp: null,
    bucket: "done",
    agent: {
      id: "agent-1",
      serverId: "host-1",
      serverLabel: "host-1",
      title: PROVISIONAL_TITLE,
      // AggregatedAgent carries the clock as a Date (the row hands it straight to
      // useWechatTimeLabel); without it the title line renders no timestamp.
      lastActivityAt: new Date(),
      status: "closed",
      cwd: "/home/dev/paseo-go/.paseo/worktrees/fix-login",
      provider: "omp",
      labels: {},
      // No placement on the fixture: the row derives `项目(worktree)` from cwd the
      // same way the screen does (`.paseo/worktrees/<name>` → parent repo = project).
      lastMessagePreview: null,
      lastMessageRole: null,
      ownership: "none",
      externalLooksActive: false,
      ...overrides,
    },
  } as unknown as ShellChatAgent;
}

// Module-level props: the row is memo'd, and react-perf wants every prop to outlive
// the render call. `renderRow` repoints the shared row at the fixture under test.
const ON_OPEN = vi.fn();
const ACTIONS = {} as ShellAgentActions;
const ROW: ChatRow<ShellChatAgent> = {
  agent: agentFixture(),
  unread: false,
  dimmed: false,
};

function renderRow(agent: ShellChatAgent, overrides: { unread?: boolean } = {}): void {
  ROW.agent = agent;
  // F32: `unread` is derive's row-level input, not an agent field — the marker tests
  // arm it independently of the bucket.
  ROW.unread = overrides.unread ?? false;
  render(<ChatListRow row={ROW} actions={ACTIONS} onOpen={ON_OPEN} />);
}

function titleLine(): string {
  return screen.getByTestId(`shell-chat-row-${KEY}`).textContent ?? "";
}

beforeEach(() => {
  // The vitest JSX transform reads React from the global (chat-row-menu-host idiom).
  vi.stubGlobal("React", React);
  usePaseoGoPinsStore.setState({ aliases: {}, pinnedIds: [] });
});

afterEach(() => {
  cleanup();
  usePaseoGoPinsStore.setState({ aliases: {}, pinnedIds: [] });
  vi.unstubAllGlobals();
});

describe("ChatListRow title line (D21: alias > 项目(worktree))", () => {
  it("renders the default 项目(worktree) for an unrenamed session whose daemon title is a prompt", () => {
    renderRow(agentFixture());
    const line = titleLine();
    expect(line).toContain("paseo-go(fix-login)");
    // The regression itself: the provisional title must not leak into the row.
    expect(line).not.toContain(PROVISIONAL_TITLE);
  });

  it("renders the shell rename alone when an alias exists", () => {
    usePaseoGoPinsStore.setState({ aliases: { [KEY]: "登录修复" } });
    renderRow(agentFixture());
    const line = titleLine();
    expect(line).toContain("登录修复");
    expect(line).not.toContain(PROVISIONAL_TITLE);
    expect(line).not.toContain("paseo-go(fix-login)");
  });

  it("falls back to the default format when the rename is cleared (留空恢复默认)", () => {
    // `ShellAgentActions.rename` maps a blank input to `setAlias(key, null)`, which
    // DELETES the slot — the row must then read the default, not an empty title.
    usePaseoGoPinsStore.getState().setAlias(KEY, "登录修复");
    usePaseoGoPinsStore.getState().setAlias(KEY, null);
    renderRow(agentFixture());
    const line = titleLine();
    expect(line).toContain("paseo-go(fix-login)");
    expect(line).not.toContain(PROVISIONAL_TITLE);
  });

  it("speaks the same title the pixels show (accessibilityLabel replaces child text)", () => {
    renderRow(agentFixture());
    expect(screen.getByTestId(`shell-chat-row-${KEY}`).getAttribute("aria-label")).toContain(
      "paseo-go(fix-login)",
    );
  });
});

// B6-OWN-HEAL (F19/D22): the row is one of the three surfaces that read the single
// pill decision, and it is the only one whose a11y label re-derives it — so both are
// pinned here against the fixture the pixels render.
describe("ChatListRow ownership pill (D22 birth axis)", () => {
  it("reads 原生 for an idle launched session and says it out loud", () => {
    renderRow(
      agentFixture({
        ownership: "none",
        externalLooksActive: false,
        origin: "launch",
      }),
    );
    expect(screen.getByTestId(`shell-chat-ownership-${KEY}`).textContent).toBe(
      "chats.ownership.state.native",
    );
    expect(screen.getByTestId(`shell-chat-row-${KEY}`).getAttribute("aria-label")).toContain(
      "chats.ownership.state.native",
    );
  });

  it("reads 外部 for an idle imported session", () => {
    renderRow(
      agentFixture({
        ownership: "none",
        externalLooksActive: false,
        origin: "import",
      }),
    );
    expect(screen.getByTestId(`shell-chat-ownership-${KEY}`).textContent).toBe(
      "chats.ownership.badge",
    );
  });

  it("keeps 未知 when the host reported neither axis (pre-go.7)", () => {
    renderRow(agentFixture({ ownership: undefined, externalLooksActive: undefined }));
    expect(screen.getByTestId(`shell-chat-ownership-${KEY}`).textContent).toBe(
      "chats.ownership.state.unknown",
    );
  });

  it("lets live evidence win over birth", () => {
    renderRow(
      agentFixture({
        ownership: "paseo",
        externalLooksActive: false,
        origin: "import",
      }),
    );
    expect(screen.getByTestId(`shell-chat-ownership-${KEY}`).textContent).toBe(
      "chats.ownership.state.native",
    );
  });
});

// B8-ROWPILL (F21, 用户拍板): WeChat's title line — title + pill own the left,
// the clock is pinned to the line's RIGHT edge and survives ANY title length.
// The assertions read the inline styles react-native-web puts on the DOM, i.e.
// the exact flex contract the native row lays out with.
describe("ChatListRow title line layout (F21 right-edge clock)", () => {
  it("keeps the clock in the right-edge group under an 80-char title", () => {
    usePaseoGoPinsStore.setState({ aliases: { [KEY]: "长".repeat(80) } });
    renderRow(agentFixture());
    const title = screen.getByTestId(`shell-chat-title-${KEY}`);
    const pill = screen.getByTestId(`shell-chat-ownership-${KEY}`);
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const trailing = time.parentElement as HTMLElement;
    // Paint order on the line: title, pill 紧随, then the right-edge group. F32
    // moved the unread marker out from between spinner and clock, so the clock ends
    // the group only when the row has no marker to wear (this fixture is read).
    expect(pill.previousElementSibling).toBe(title);
    expect(trailing.previousElementSibling).toBe(pill);
    expect(trailing.lastElementChild).toBe(time);
    // The group eats the leftover width and right-aligns its content; the clock
    // and markers are shrink-0, never squeezed out. REVIEW-B9-03 (Main 裁定 B/A):
    // the shrinkable members are the title (primary, ruling 6) and the ownership
    // pill (secondary relief valve — proportional truncation is the adjudicated
    // posture; a smaller factor is dead on native, and the word-length root fix
    // is the G3 card).
    expect(trailing.style.flexGrow).toBe("1");
    expect(trailing.style.justifyContent).toBe("flex-end");
    expect(trailing.style.flexShrink).toBe("0");
    expect(title.style.flexShrink).toBe("1");
    expect(pill.style.flexShrink).toBe("1");
    expect(time.style.flexShrink).toBe("0");
    // F21's 右上小灰字: the theme's muted grey token (fixture #666666).
    expect(time.style.color).toBe("rgb(102, 102, 102)");
  });

  it("keeps the running spinner left of the clock inside the group (ruling 8)", () => {
    renderRow({ ...agentFixture(), bucket: "running" });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const spinner = screen.getByTestId(`shell-chat-running-${KEY}`);
    const trailing = time.parentElement as HTMLElement;
    const kids = Array.from(trailing.children);
    expect(kids.indexOf(spinner)).toBeGreaterThanOrEqual(0);
    expect(kids.indexOf(spinner)).toBeLessThan(kids.indexOf(time));
  });
});

// B9-BADGE (F32, 用户截图钉死): the unread indicator is ONE marker in ONE slot —
// right of the clock, inside the right-edge group. REVIEW-B9-08 口径: the GROUP is
// the title line's last pixel, not any single member. Order inside the group:
// spinner → clock → marker → 子任务 chip. `count > 0` hands the slot to the count
// pill; otherwise an idle unread row wears the dot; active rows wear neither.
describe("ChatListRow right-edge unread slot (F32)", () => {
  /** Both marker testIDs at once — a row that renders two fails the length check. */
  const markers = (): HTMLElement[] =>
    screen.queryAllByTestId(new RegExp(`^shell-chat-(unread|count)-${KEY}$`));

  it("puts the unread dot right of the clock — the group's tail when no chip rides", () => {
    renderRow({ ...agentFixture(), bucket: "attention" }, { unread: true });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const dot = screen.getByTestId(`shell-chat-unread-${KEY}`);
    expect(dot.previousElementSibling).toBe(time);
    expect((time.parentElement as HTMLElement).lastElementChild).toBe(dot);
    expect(markers()).toHaveLength(1);
  });

  it("hands the same slot to the count pill while approvals pend — never two markers", () => {
    // `done` + unread would show the dot on its own; count>0 takes the slot instead
    // (C18: the pill is a state marker — permission requests carry no attention stamp,
    // so it must not be gated on `unread`, and the dot steps aside for it).
    renderRow({ ...agentFixture({ pendingPermissionCount: 3 }) }, { unread: true });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const pill = screen.getByTestId(`shell-chat-count-${KEY}`);
    expect(pill.previousElementSibling).toBe(time);
    expect(pill.textContent).toBe("3");
    expect(markers()).toHaveLength(1);
  });

  it("keeps the group order spinner → clock → marker on a running row", () => {
    renderRow({
      ...agentFixture({ pendingPermissionCount: 1 }),
      bucket: "running",
    });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const spinner = screen.getByTestId(`shell-chat-running-${KEY}`);
    const pill = screen.getByTestId(`shell-chat-count-${KEY}`);
    const kids = Array.from((time.parentElement as HTMLElement).children);
    expect(kids.indexOf(spinner)).toBe(0);
    expect(kids.indexOf(time)).toBe(1);
    expect(kids.indexOf(pill)).toBe(2);
  });

  it("wears no marker on an active unread row — status light + bold title carry it", () => {
    renderRow({ ...agentFixture(), bucket: "needs_input" }, { unread: true });
    expect(markers()).toHaveLength(0);
    // The clock keeps the right edge to itself, i.e. nothing was left behind it.
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    expect((time.parentElement as HTMLElement).lastElementChild).toBe(time);
  });

  it("shrinks the long title, never the clock or the marker", () => {
    usePaseoGoPinsStore.setState({ aliases: { [KEY]: "长".repeat(80) } });
    renderRow({ ...agentFixture(), bucket: "attention" }, { unread: true });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const dot = screen.getByTestId(`shell-chat-unread-${KEY}`);
    const trailing = time.parentElement as HTMLElement;
    expect(trailing.style.flexShrink).toBe("0");
    expect(time.style.flexShrink).toBe("0");
    expect(dot.style.flexShrink).toBe("0");
    expect(screen.getByTestId(`shell-chat-title-${KEY}`).style.flexShrink).toBe("1");
    expect(trailing.lastElementChild).toBe(dot);
  });
});

// B9-SUBACT (F31 ruling B+, 用户拍板) + REVIEW-B9-03 (D6): the 子任务 chip joins
// the right-edge slot family AFTER the unread marker — the same-screen order is
// spinner → time → unread → 子任务, `0`/absent never renders, and the pixels are
// icon+digit (the 「子任务×N」 word string overflowed the line; f6 frame).
describe("ChatListRow 子任务 chip (B9-SUBACT + REVIEW-B9-03)", () => {
  it("renders the count right of the unread dot — last in the right-edge group", () => {
    renderRow({ ...agentFixture({ activeSubagents: 2 }), bucket: "attention" }, { unread: true });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const dot = screen.getByTestId(`shell-chat-unread-${KEY}`);
    const badge = screen.getByTestId(`shell-chat-subagents-${KEY}`);
    const trailing = time.parentElement as HTMLElement;
    const kids = Array.from(trailing.children);
    expect(kids.indexOf(time)).toBe(0);
    expect(kids.indexOf(dot)).toBe(1);
    expect(kids.indexOf(badge)).toBe(2);
    expect(trailing.lastElementChild).toBe(badge);
    // REVIEW-B9-03 (D6): pixels are the digit alone (the Users glyph rides beside
    // it, stubbed to null in jsdom); the 「子任务」 word is spoken in the row's
    // a11y label, not shown. The word string here was the f6 overflow.
    expect(badge.textContent).toBe("2");
  });

  it("keeps the full group order spinner → time → count pill → 子任务 badge", () => {
    renderRow({
      ...agentFixture({ pendingPermissionCount: 1, activeSubagents: 3 }),
      bucket: "running",
    });
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const spinner = screen.getByTestId(`shell-chat-running-${KEY}`);
    const pill = screen.getByTestId(`shell-chat-count-${KEY}`);
    const badge = screen.getByTestId(`shell-chat-subagents-${KEY}`);
    const kids = Array.from((time.parentElement as HTMLElement).children);
    expect(kids.indexOf(spinner)).toBe(0);
    expect(kids.indexOf(time)).toBe(1);
    expect(kids.indexOf(pill)).toBe(2);
    expect(kids.indexOf(badge)).toBe(3);
  });

  it("renders nothing for 0 or an absent count (COMPAT(subagentActivity))", () => {
    cleanup();
    renderRow(agentFixture({ activeSubagents: 0 }));
    expect(screen.queryByTestId(`shell-chat-subagents-${KEY}`)).toBeNull();
    cleanup();
    renderRow(agentFixture({ activeSubagents: null }));
    expect(screen.queryByTestId(`shell-chat-subagents-${KEY}`)).toBeNull();
  });

  it("speaks the chip in the row label — the FULL read order pinned (REVIEW-B9-13)", () => {
    renderRow(agentFixture({ activeSubagents: 4 }));
    // B8-08 全串先例: toContain let a reordered or duplicated label pass. The
    // whole spoken string is the contract — title · subtitle · ownership · 子任务
    // (the badge word's slot is LAST before the offline tail; move it → this red).
    expect(screen.getByTestId(`shell-chat-row-${KEY}`).getAttribute("aria-label")).toBe(
      "paseo-go(fix-login) · chats.row.noMessages · chats.ownership.state.unknown · chats.subagents.badge:4",
    );
  });
});

// REVIEW-B9-07 (裁定=共享基座): the count pill and the 子任务 chip are ONE base +
// a color pair each. The pre-fix build hand-copied the seven geometry properties
// (REVIEW-B8-05 同型 drift surface); the exported base + these consumption pins
// make "change one height, the sibling does not follow" structurally impossible.
describe("ChatListRow slot-chip shared base (REVIEW-B9-07)", () => {
  it("count pill and 子任务 chip wear the same seven geometry properties, from the base", () => {
    renderRow({
      ...agentFixture({ pendingPermissionCount: 1, activeSubagents: 2 }),
      bucket: "running",
    });
    const pill = screen.getByTestId(`shell-chat-count-${KEY}`);
    const chip = screen.getByTestId(`shell-chat-subagents-${KEY}`);
    for (const prop of [
      "minWidth",
      "height",
      "flexDirection",
      "borderRadius",
      "paddingLeft",
      "alignItems",
      "justifyContent",
      "flexShrink",
    ] as const) {
      expect(chip.style[prop]).toBe(pill.style[prop]);
    }
    // And the shared values ARE the exported base — a base edit moves both chips
    // and this pin together; neither chip may hand-copy geometry anymore.
    expect(pill.style.minWidth).toBe(`${SLOT_CHIP_DP.minWidth}px`);
    expect(pill.style.height).toBe(`${SLOT_CHIP_DP.height}px`);
    expect(pill.style.alignItems).toBe(SLOT_CHIP_DP.alignItems);
    expect(pill.style.justifyContent).toBe(SLOT_CHIP_DP.justifyContent);
    expect(pill.style.flexShrink).toBe(`${SLOT_CHIP_DP.flexShrink}`);
  });

  it("keeps the unread dot the 8dp point tier — outside the chip base by design", () => {
    renderRow({ ...agentFixture(), bucket: "attention" }, { unread: true });
    const dot = screen.getByTestId(`shell-chat-unread-${KEY}`);
    expect(dot.style.width).toBe("8px");
    expect(dot.style.height).toBe("8px");
    expect(dot.style.minWidth).toBe("");
  });
});

// REVIEW-B9-03 (D6): the f6 regression — an unbounded localized word string rode
// the shrink-0 right-edge group and pushed the title line past its box (light + ⋯
// covered, title at 0 width). jsdom has no layout engine, so the fix is pinned as
// a SUM: every fixed width ships in TITLE_LINE_BUDGET_DP, the scenario's text is
// measured off the rendered DOM, and the total must fit the title line's box at
// the narrowest compact list width on record. Pre-fix (word badge) the sum is
// ~306dp against a 232dp box — this suite was RED before the chip became
// icon+digit. Main 裁定 B (执行中扩权) adds the extreme stack's floor model: with
// the title at 0 and the ownership pill truncated to its ellipsis floor, the
// right-edge group alone must still fit the column's box — the group NEVER
// truncates, and the pill is the line's only secondary shrinkable member.
describe("ChatListRow title-line width budget (REVIEW-B9-03)", () => {
  const availableDp = TITLE_LINE_BUDGET_DP.narrowestCompactWidthDp - TITLE_LINE_CHROME_DP;

  it("fits running + count pill + 子任务 chip + short title at the narrowest compact width", () => {
    usePaseoGoPinsStore.setState({ aliases: { [KEY]: "登录修复" } });
    renderRow({
      ...agentFixture({ pendingPermissionCount: 1, activeSubagents: 2 }),
      bucket: "running",
    });
    const used = titleLineWidthDp({
      titleText: screen.getByTestId(`shell-chat-title-${KEY}`).textContent ?? "",
      spinner: screen.queryByTestId(`shell-chat-running-${KEY}`) !== null,
      clockText: screen.getByTestId(`shell-chat-time-${KEY}`).textContent ?? "",
      countText: screen.getByTestId(`shell-chat-count-${KEY}`).textContent,
      subagentCountText: screen.getByTestId(`shell-chat-subagents-${KEY}`).textContent,
    });
    expect(used).toBeLessThanOrEqual(availableDp);
    // The box itself is the registered arithmetic, not a magic number: 380 − 148.
    expect(availableDp).toBe(232);
  });

  it("keeps the budget table honest: the row chrome's DOM geometry matches the table", () => {
    renderRow(agentFixture());
    const trigger = screen.getByTestId(`shell-chat-row-${KEY}`);
    const avatar = screen.getByTestId(`shell-chat-avatar-${KEY}`);
    const more = screen.getByTestId(`shell-chat-more-${KEY}`);
    const trailing = screen.getByTestId(`shell-chat-time-${KEY}`).parentElement as HTMLElement;
    expect(avatar.style.width).toBe(`${TITLE_LINE_BUDGET_DP.avatarDp}px`);
    expect(trigger.style.paddingLeft).toBe(`${TITLE_LINE_BUDGET_DP.rowPaddingHorizontalDp}px`);
    expect(trigger.style.gap).toBe(`${TITLE_LINE_BUDGET_DP.rowGapDp}px`);
    expect(more.style.paddingLeft).toBe(`${TITLE_LINE_BUDGET_DP.morePaddingHorizontalDp}px`);
    expect(trailing.style.gap).toBe(`${TITLE_LINE_BUDGET_DP.slotGapDp}px`);
  });

  it("holds the f6 extreme stack inside the lg column box once the truncatables floor", () => {
    // The f6 scene: 外部·运行中 pill + clock + 子任务 chip, no spinner, no count
    // pill. Pre-裁定-B the pill was shrink-0 — its full word ate the box and the
    // chip spilled over the light (device bounds: 725px > the 708px line edge).
    // Post-fix the truncatables floor (title 0, pill → ellipsis floor) and the
    // group's FULL intrinsic width still fits the 300dp lg list column.
    usePaseoGoPinsStore.setState({ aliases: { [KEY]: "tmp" } });
    renderRow({
      ...agentFixture({
        ownership: "external",
        externalLooksActive: true,
        activeSubagents: 2,
      }),
      bucket: "attention",
    });
    const floorDp = titleLineFloorWidthDp({
      spinner: screen.queryByTestId(`shell-chat-running-${KEY}`) !== null,
      clockText: screen.getByTestId(`shell-chat-time-${KEY}`).textContent ?? "",
      countText: null,
      subagentCountText: screen.getByTestId(`shell-chat-subagents-${KEY}`).textContent,
      ownershipPill: true,
    });
    const lgColumnBoxDp = 300 - TITLE_LINE_CHROME_DP;
    expect(floorDp).toBeLessThanOrEqual(lgColumnBoxDp);
  });

  it("keeps the pill the ONLY secondary shrinkable member — the group never truncates", () => {
    renderRow({
      ...agentFixture({ pendingPermissionCount: 1, activeSubagents: 2 }),
      bucket: "running",
    });
    const title = screen.getByTestId(`shell-chat-title-${KEY}`);
    const pill = screen.getByTestId(`shell-chat-ownership-${KEY}`);
    const time = screen.getByTestId(`shell-chat-time-${KEY}`);
    const count = screen.getByTestId(`shell-chat-count-${KEY}`);
    const chip = screen.getByTestId(`shell-chat-subagents-${KEY}`);
    expect(title.style.flexShrink).toBe("1"); // primary (ruling 6)
    expect(pill.style.flexShrink).toBe("1"); // secondary (Main 裁定 B/A)
    // The pill's word is truncate-bounded, not wrap-bounded — react-native-web
    // renders `numberOfLines` as atomic nowrap+ellipsis+hidden classes (the
    // inline style stays empty; `r-<property>-` is RNW's stable encoding).
    const word = pill.firstElementChild as HTMLElement;
    expect(word.className).toMatch(/r-whiteSpace-/);
    expect(word.className).toMatch(/r-textOverflow-/);
    expect(word.className).toMatch(/r-overflow-/);
    // Everything in the right-edge group stays shrink-0 — the relief valves are
    // exactly the two words, never a marker, the clock or the group container.
    expect(time.style.flexShrink).toBe("0");
    expect(count.style.flexShrink).toBe("0");
    expect(chip.style.flexShrink).toBe("0");
    expect((time.parentElement as HTMLElement).style.flexShrink).toBe("0");
  });
});

/** #rrggbb → css rgb()，即 react-native-web 写进 DOM 的形态。 */
function cssRgb(hex: string): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return `rgb(${channels.join(", ")})`;
}

// REVIEW-B8-05: 两屏同色断言的对话列路径——色块底色钉到 identityColor 函数
// 本身（填充表已上收 project-avatar.ts 单一真相；导入行同款断言钉在
// import.test.tsx，任一路径换常量→必红）。
describe("ChatListRow project tile fill (REVIEW-B8-05 两屏同色)", () => {
  it("fills the tile with the shared identity color", () => {
    renderRow(agentFixture());
    const avatar = screen.getByTestId(`shell-chat-avatar-${KEY}`);
    expect(avatar.style.backgroundColor).toBe(
      cssRgb(identityColor(projectAvatarFor("paseo-go").colorName)),
    );
  });
});

// REVIEW-B8-13（用户拍板 U7=B）：「同一时间输入→两屏同一串」的对话列例——
// 昨天正午 → 「昨天」微信串（echo-t 按 key 钉）。导入行改走同函数后与这里
// 同串（对例钉在 import.test.tsx，修复前行走「1d」相对制必红）。
describe("ChatListRow clock tier (REVIEW-B8-13 两屏同串)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date(2026, 9, 2, 15, 0, 0).getTime(),
      toFake: ["Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says yesterday for yesterday-noon", () => {
    renderRow(agentFixture({ lastActivityAt: new Date(2026, 9, 1, 12, 0, 0) }));
    expect(screen.getByTestId(`shell-chat-time-${KEY}`).textContent).toBe("chats.time.yesterday");
  });
});
