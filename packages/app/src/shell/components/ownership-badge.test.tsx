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
import { darkTheme, lightTheme } from "@/styles/theme";

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

  it("stays shrink-safe on the title line (F21's pill posture)", () => {
    const { pill } = renderPill("paseo", false);
    expect(pill.style.flexShrink).toBe("0");
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
      { ownership: "paseo", externalLooksActive: false, fill: "#0a1112", word: "#0b1314" },
      { ownership: "external", externalLooksActive: true, fill: "#0c1516", word: "#0d1718" },
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

// The pill fill is an 8-digit tint — what the row behind it actually shows through.
function compositeOverRow(tintHex8: string, rowHex: string): string {
  const t = tintHex8.replace("#", "");
  if (t.length !== 8) {
    throw new Error(`expected an 8-digit tint, got ${tintHex8}`);
  }
  const alpha = Number.parseInt(t.slice(6, 8), 16) / 255;
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
// word under the 4.5 line. The neutral pair is generated by the same statusTints rule as
// its siblings (same alpha, same strength) and every pair must clear both floors in both
// bands. Row底 = chat-list-row's surface0 (chat-list-row.tsx).
describe("ownership pill contrast floors (REVIEW-B8-10)", () => {
  // Same mapping as the component's style block; the sentinel case above is what proves
  // the block reads exactly these tokens, so this matrix lands on what ships.
  const PILL_PAIRS = [
    { state: "原生", fill: "statusSuccessTint", word: "statusSuccess" },
    { state: "外部", fill: "statusWarningTint", word: "statusWarning" },
    { state: "未知", fill: "statusNeutralTint", word: "statusNeutral" },
  ] as const;
  const BANDS = [
    { name: "light", theme: lightTheme },
    { name: "dark", theme: darkTheme },
  ] as const;
  for (const band of BANDS) {
    for (const pair of PILL_PAIRS) {
      it(`${band.name} ${pair.state}: word ≥ 4.5:1 on the fill, fill ≥ 1.15:1 on the row`, () => {
        const fill = band.theme.colors[pair.fill];
        const word = band.theme.colors[pair.word];
        const onRow = compositeOverRow(fill, band.theme.colors.surface0);
        expect(contrastRatio(word, onRow)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(onRow, band.theme.colors.surface0)).toBeGreaterThanOrEqual(1.15);
      });
    }
  }
});
