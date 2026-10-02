/**
 * @vitest-environment jsdom
 */
// B5-OWNVIS (F16/D19) acceptance — 行渲染三态 + 胶囊数据接线的共用渲染器. Both
// surfaces (chat row after the title, session capsule primary row) mount this
// pill UNCONDITIONALLY with the agent's flat COMPAT(agentOwnership) pair, so the
// pill's own three-state rendering is the contract the device frames show:
// 原生 for paseo, 外部/外部·运行中 for external (B4 pair unchanged), 未知 for
// none AND for a pre-go.7 daemon (undefined/null — the honest word). The pill
// never returns null: there is no posture without a word.
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  // Echo t: the assertion is on the KEY the pill selects — the locale bundles
  // (parity-pinned by locales.test.ts) own the key→word step.
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo" }));

import { OwnershipBadge } from "@/shell/components/ownership-badge";
import {
  darkClaudeTheme,
  darkGhosttyTheme,
  darkTheme,
  lightTheme,
  THEME_OPTIONS,
  type Theme,
} from "@/styles/theme";

beforeEach(() => {
  // The vitest JSX transform reads React from the global (chat-row-menu-host idiom).
  vi.stubGlobal("React", React);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPill(
  ownership: unknown,
  externalLooksActive: unknown,
  origin?: unknown,
): { pill: HTMLElement; word: HTMLElement } {
  cleanup(); // one pill per assertion — tests probe several postures in a row
  render(
    <OwnershipBadge
      ownership={ownership as string | null | undefined}
      externalLooksActive={externalLooksActive as boolean | null | undefined}
      origin={origin as string | null | undefined}
      testID="pill"
    />,
  );
  const pill = screen.getByTestId("pill");
  return { pill, word: pill.firstElementChild as HTMLElement };
}

function pillText(ownership: unknown, externalLooksActive: unknown, origin?: unknown): string {
  return renderPill(ownership, externalLooksActive, origin).pill.textContent ?? "";
}
// jsdom (CSSOM) and react-native-web round an 8-digit hex alpha differently
// (0.122 vs 0.12), so the tint assertions compare parsed rgba components with a
// tolerance instead of the serialized strings. Both sides go through the same
// CSS parser; an unparseable value fails loudly instead of "" === "".
function rgbaOf(value: string): [number, number, number, number] {
  const probe = document.createElement("div");
  probe.style.color = value;
  const parsed = probe.style.color;
  if (parsed.length === 0) throw new Error(`jsdom could not parse color ${value}`);
  const nums = parsed.match(/[\d.]+/g)!.map(Number);
  return [nums[0]!, nums[1]!, nums[2]!, nums.length > 3 ? nums[3]! : 1];
}

function expectCssColor(actual: string, expected: string): void {
  const [ar, ag, ab, aa] = rgbaOf(actual);
  const [er, eg, eb, ea] = rgbaOf(expected);
  expect([ar, ag, ab]).toEqual([er, eg, eb]);
  expect(Math.abs(aa! - ea!)).toBeLessThan(0.01);
}

describe("OwnershipBadge tri-state rendering (always-on)", () => {
  it("paseo renders the 原生 word on the neutral tone", () => {
    expect(pillText("paseo", false)).toBe("chats.ownership.state.native");
  });

  it("external keeps the B4 warning pair: 外部, and 外部·运行中 while the writer looks alive", () => {
    expect(pillText("external", false)).toBe("chats.ownership.badge");
    expect(pillText("external", true)).toBe("chats.ownership.badgeActive");
    // The COMPAT posture reads a missing companion as false.
    expect(pillText("external", undefined)).toBe("chats.ownership.badge");
    expect(pillText("external", null)).toBe("chats.ownership.badge");
  });

  it("none AND a pre-go.7 daemon render the 未知 word — the pill is never absent", () => {
    expect(pillText("none", null)).toBe("chats.ownership.state.unknown");
    expect(pillText(null, null)).toBe("chats.ownership.state.unknown");
    expect(pillText(undefined, undefined)).toBe("chats.ownership.state.unknown");
  });
});

// B6-OWN-HEAL (F19/D22): the pill's third input is the birth axis, and BOTH surfaces
// (chat row, session capsule) mount this one renderer — so the words the device
// frames show for an idle session are exactly these.
describe("OwnershipBadge birth axis (B6-OWN-HEAL)", () => {
  it("renders 原生 for a launched session with no live-writer evidence", () => {
    expect(pillText("none", false, "launch")).toBe("chats.ownership.state.native");
    // A daemon that reports the birth axis but has never observed this transcript
    // (the pre-B4 record shape) is the case the F19 report was about.
    expect(pillText(undefined, undefined, "launch")).toBe("chats.ownership.state.native");
  });

  it("renders the plain 外部 for an imported idle session — never 运行中", () => {
    expect(pillText("none", false, "import")).toBe("chats.ownership.badge");
    expect(pillText(null, true, "import")).toBe("chats.ownership.badge");
  });

  it("keeps live evidence above birth", () => {
    expect(pillText("paseo", false, "import")).toBe("chats.ownership.state.native");
    expect(pillText("external", true, "launch")).toBe("chats.ownership.badgeActive");
  });

  it("still says 未知 when neither axis was reported", () => {
    expect(pillText("none", false, null)).toBe("chats.ownership.state.unknown");
  });
});

// B8-ROWPILL (F22, 用户拍板): the three states read apart by COLOR story, not just
// by word — 原生=success 浅染, 外部=warning 浅染, 未知=中性. The literals below are
// the fixture theme's token VALUES (test-stubs/react-native-unistyles.ts mirrors the
// real light band: tint = the status color at 12% alpha); pinning them catches a style
// block quietly falling back to a DIFFERENT color. REVIEW-B8-07: a literal equal to the
// token's own value is byte-identical here and slips through — the sentinel case below
// closes that hole, and REVIEW-B8-10's matrix case pins the REAL theme's contrast floors.
describe("OwnershipBadge tri-state tint (B8 F22)", () => {
  it("原生 wears the success pair: statusSuccessTint fill + statusSuccess word", () => {
    const { pill, word } = renderPill("paseo", false);
    expectCssColor(pill.style.backgroundColor, "#15803d1f"); // statusSuccessTint
    expectCssColor(word.style.color, "#15803d"); // statusSuccess
  });

  it("外部 keeps the B4 warning pair verbatim", () => {
    const { pill, word } = renderPill("external", true);
    expectCssColor(pill.style.backgroundColor, "#d977061f"); // statusWarningTint
    expectCssColor(word.style.color, "#d97706"); // statusWarning
  });

  it("未知 wears the neutral pair: statusNeutralTint fill + statusNeutral word", () => {
    const { pill, word } = renderPill("none", false, null);
    expectCssColor(pill.style.backgroundColor, "#52525b1f"); // statusNeutralTint
    expectCssColor(word.style.color, "#52525b"); // statusNeutral
  });

  it("is the title line's secondary relief valve (REVIEW-B9-03 Main 裁定 B/A)", () => {
    // The pill truncates (numberOfLines=1 + flexShrink:1) instead of ever pushing
    // the right-edge group over the row's box. The proportional truncation of
    // long-title rows is the ADJUDICATED secondary-relief posture — a smaller
    // factor is dead on native (Yoga has no freeze-and-redistribute; the device
    // frames proved the badge pushed out again at 0.01) — and the word-length
    // root fix lives in the G3 card, not here.
    const { pill, word } = renderPill("paseo", false);
    expect(pill.style.flexShrink).toBe("1");
    expect(word.className).toMatch(/r-whiteSpace-/);
    expect(word.className).toMatch(/r-textOverflow-/);
    expect(word.className).toMatch(/r-overflow-/);
  });
});

// REVIEW-B8-07 (P2): the pins above cannot tell「reads the token」from「inlined the
// token's current value as a literal」— the latter is exactly the shape F22 forbids and
// it renders byte-identically. Sentinel closes the hole: vi.resetModules() hands the stub
// a FRESH fixture instance (the component's `react-native-unistyles` import resolves to
// the same file through the vitest alias); mutate every color token the pill reads to a
// distinct sentinel BEFORE re-importing it, so its StyleSheet.create evaluates against the
// sentinels. A block that reads theme.colors.X renders the sentinel; a baked literal —
// even one equal to the token's real value — renders the old colour and fails.
describe("OwnershipBadge paints from theme tokens (REVIEW-B8-07 sentinel)", () => {
  it("fill and word colors follow mutated token values on re-import", async () => {
    cleanup();
    vi.resetModules();
    const { testTheme } = await import("../../../test-stubs/react-native-unistyles");
    Object.assign(testTheme.colors, {
      statusSuccessTint: "#0a1112",
      statusSuccess: "#0b1314",
      statusWarningTint: "#0c1516",
      statusWarning: "#0d1718",
      statusNeutralTint: "#0e191a",
      statusNeutral: "#0f1b1c",
    });
    const { OwnershipBadge: TokenPill } = await import("@/shell/components/ownership-badge");
    const cases = [
      {
        ownership: "paseo",
        externalLooksActive: false,
        fill: "#0a1112",
        word: "#0b1314",
      },
      {
        ownership: "external",
        externalLooksActive: true,
        fill: "#0c1516",
        word: "#0d1718",
      },
      {
        ownership: "none",
        externalLooksActive: false,
        origin: null,
        fill: "#0e191a",
        word: "#0f1b1c",
      },
    ];
    for (const c of cases) {
      render(
        <TokenPill
          ownership={c.ownership}
          externalLooksActive={c.externalLooksActive}
          origin={c.origin}
          testID="pill"
        />,
      );
      const pill = screen.getByTestId("pill");
      expectCssColor(pill.style.backgroundColor, c.fill);
      expectCssColor((pill.firstElementChild as HTMLElement).style.color, c.word);
      cleanup();
    }
  });
});

// WCAG relative luminance + contrast (same shape as styles/identity-colors.test.ts's
// helper), over the REAL theme.ts bands — the stub fixture only proves the component
// reads tokens, not that the shipped values are legible.
function channelLinear(byte: number): number {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channelLinear(Number.parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * 一条 tint token → 底色 + alpha。两种合法形态都要认：band 写法的 8 位 hex，和
 * theme.ts 逐主题求解后写出的 rgba（可行窗窄于一个 alpha 字节时才有，见 REVIEW-B9-09）。
 */
function tintFill(token: string): { hex: string; alpha: number } {
  const digits = token.replace("#", "");
  if (digits.length === 8) {
    return {
      hex: `#${digits.slice(0, 6)}`,
      alpha: Number.parseInt(digits.slice(6, 8), 16) / 255,
    };
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(token);
  if (rgba) {
    const channels = [rgba[1], rgba[2], rgba[3]].map((v) =>
      Number.parseInt(v ?? "0", 10)
        .toString(16)
        .padStart(2, "0"),
    );
    return {
      hex: `#${channels.join("")}`,
      alpha: Number.parseFloat(rgba[4] ?? "0"),
    };
  }
  throw new Error(`expected an 8-digit tint or an rgba() tint, got ${token}`);
}

// The pill fill is a tint — what the row behind it actually shows through.
function compositeOverRow(tintToken: string, rowHex: string): string {
  const { hex, alpha } = tintFill(tintToken);
  const t = hex.replace("#", "");
  const g = rowHex.replace("#", "");
  const mix = (i: number) =>
    Math.round(
      alpha * Number.parseInt(t.slice(i, i + 2), 16) +
        (1 - alpha) * Number.parseInt(g.slice(i, i + 2), 16),
    );
  return `#${[mix(0), mix(2), mix(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// REVIEW-B8-10 (P2, 裁定 D6): 未知 must still READ as a pill — its fill distinguishable
// from the row behind it, its word AA-legible at fontSize.sm (12px = normal-text band).
// The card's recomputation: the old pair (surface2 fill + foregroundMuted word) sat at
// 1.10:1 fill-on-row and 4.40:1 word-on-fill in the light band — near-invisible fill,
// word under the 4.5 line. Row底 = chat-list-row's surface0 (chat-list-row.tsx).
//
// REVIEW-B9-09 (P2, 裁定 A): this matrix used to enumerate light/dark, so the six
// selectable dark variants were never rendered against either floor — that is exactly how
// ghostty's 4.12:1 未知 shipped. BANDS is now the theme registry itself (every concrete
// THEME_OPTIONS entry, variants included: a new variant is in the matrix the day it is
// added), and the third assertion pins the solve's shape: a variant's tint may only be
// *dimmer* than its band's authored alpha, never louder — 求解只压不抬.
describe("ownership pill contrast floors (REVIEW-B8-10, 全主题矩阵 REVIEW-B9-09)", () => {
  // Same mapping as the component's style block; the sentinel case above is what proves
  // the block reads exactly these tokens, so this matrix lands on what ships.
  const PILL_PAIRS = [
    { state: "原生", fill: "statusSuccessTint", word: "statusSuccess" },
    { state: "外部", fill: "statusWarningTint", word: "statusWarning" },
    // chat-list-row 的「子任务×N」chip 按的是同一对 token（subagentBadge +
    // subagentBadgeText），所以这一行同时是 未知 pill 与子任务 chip 的下限。
    {
      state: "未知 / 子任务 chip",
      fill: "statusNeutralTint",
      word: "statusNeutral",
    },
  ] as const;
  const BANDS = THEME_OPTIONS.filter(
    (option): option is Extract<(typeof THEME_OPTIONS)[number], { theme: Theme }> =>
      "theme" in option,
  ).map((option) => ({ name: option.name, theme: option.theme }));
  const primaryOf = (scheme: Theme["colorScheme"]): Theme =>
    scheme === "light" ? lightTheme : darkTheme;

  // 底/行 1.15 这一档只有一格取不到，而且不是「再解一解」能解决的：字/底 与 底/行
  // 沿「行 — 底 — 字」这条线相乘（contrast(word,row) = contrast(word,fill) ×
  // contrast(fill,row)），所以一行必须给这一对留出 4.5 × 1.15 = 5.175 的跨度；而合成色
  // 按 8-bit 取整，底/行能取的值是一级一级台阶，不是连续区间。ghostty 的 surface0 给
  // statusWarning 留 5.19——够，但只够 0.3%，台阶（1.1451 → 1.1610）比可行窗
  // 1.1500–1.1538 宽，扫遍整条 alpha 轴没有一个落点。求解器因此让 AA 赢（字 3.99 →
  // 4.52），底停在 1.145，也就是 theme.ts 无解分支写下的那句「a word one must read
  // outranks a fill one may skip」。跨度一旦变大（深色 band 抬亮、或 ghostty 的
  // surface0 压暗），这张表就该清空。
  const AA_OVER_FILL: Record<string, number> = {
    "ghostty · 外部": 1.14,
  };

  for (const band of BANDS) {
    for (const pair of PILL_PAIRS) {
      const cell = `${band.name} · ${pair.state}`;
      const fillFloor = AA_OVER_FILL[cell] ?? 1.15;
      it(`${cell}: word ≥ 4.5:1 on the fill, fill ≥ ${fillFloor.toFixed(2)}:1 on the row`, () => {
        const fill = band.theme.colors[pair.fill];
        const word = band.theme.colors[pair.word];
        const onRow = compositeOverRow(fill, band.theme.colors.surface0);
        // 字下限没有例外——任何主题、任何状态都得读得出来（卡 09 的病灶就是这一条）。
        expect(contrastRatio(word, onRow)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(onRow, band.theme.colors.surface0)).toBeGreaterThanOrEqual(fillFloor);
        // 只压不抬：变体的 alpha 不得超过本档 band 的写法（超了=求解器在替品牌改强度）。
        const authored = primaryOf(band.theme.colorScheme).colors[pair.fill];
        expect(tintFill(fill).alpha).toBeLessThanOrEqual(tintFill(authored).alpha + 1e-9);
      });
    }
  }

  // 卡 09 点名的两档单独钉一遍，各钉一件矩阵钉不到的事：ghostty 是修复前 4.12 的那一档，
  // 求解必须真的对它出手（alpha 严格低于 band——不然过的只是别的主题）；claude 是过线
  // 但只剩 0.35 余量的边界档，它必须仍是 band 的原写法（被压暗=求解器过宽）。
  it("ghostty 被压暗后才过线；claude 是未压暗的边界档", () => {
    const ghostty = darkGhosttyTheme.colors;
    expect(
      contrastRatio(
        ghostty.statusNeutral,
        compositeOverRow(ghostty.statusNeutralTint, ghostty.surface0),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(tintFill(ghostty.statusNeutralTint).alpha).toBeLessThan(
      tintFill(darkTheme.colors.statusNeutralTint).alpha,
    );
    const claude = darkClaudeTheme.colors;
    expect(
      contrastRatio(
        claude.statusNeutral,
        compositeOverRow(claude.statusNeutralTint, claude.surface0),
      ),
    ).toBeGreaterThanOrEqual(4.8);
    expect(claude.statusNeutralTint).toBe(`${claude.statusNeutral}29`);
  });
});
