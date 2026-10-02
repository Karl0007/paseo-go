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

vi.mock("react-i18next", () => ({
  // Echo t: the row's title is built from plain strings; only the 占位 fallback is a
  // locale key, and pinning it by key is exactly as strong as pinning a word.
  // `i18n` feeds the row's clock formatter (useWechatTimeLabel reads the locale).
  useTranslation: () => ({
    t: (key: string) => key,
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

import { ChatListRow, type ShellChatAgent } from "@/shell/components/chat-list-row";
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
const ROW: ChatRow<ShellChatAgent> = { agent: agentFixture(), unread: false, dimmed: false };

function renderRow(agent: ShellChatAgent): void {
  ROW.agent = agent;
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
    renderRow(agentFixture({ ownership: "none", externalLooksActive: false, origin: "launch" }));
    expect(screen.getByTestId(`shell-chat-ownership-${KEY}`).textContent).toBe(
      "chats.ownership.state.native",
    );
    expect(screen.getByTestId(`shell-chat-row-${KEY}`).getAttribute("aria-label")).toContain(
      "chats.ownership.state.native",
    );
  });

  it("reads 外部 for an idle imported session", () => {
    renderRow(agentFixture({ ownership: "none", externalLooksActive: false, origin: "import" }));
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
    renderRow(agentFixture({ ownership: "paseo", externalLooksActive: false, origin: "import" }));
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
    // Paint order on the line: title, pill 紧随, then the right-edge group —
    // and the clock is that group's LAST child (the row's rightmost pixel).
    expect(pill.previousElementSibling).toBe(title);
    expect(trailing.previousElementSibling).toBe(pill);
    expect(trailing.lastElementChild).toBe(time);
    // The group eats the leftover width and right-aligns its content; only the
    // title may shrink — pill and clock are shrink-0, never squeezed out.
    expect(trailing.style.flexGrow).toBe("1");
    expect(trailing.style.justifyContent).toBe("flex-end");
    expect(trailing.style.flexShrink).toBe("0");
    expect(title.style.flexShrink).toBe("1");
    expect(pill.style.flexShrink).toBe("0");
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
