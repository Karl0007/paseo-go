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
// real light band: tint = the status color at 12% alpha); pinning them here is what
// catches a style block quietly falling back to surface2 or a hardcoded hex.
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

  it("未知 wears the neutral pair: surface2 fill + foregroundMuted word", () => {
    const { pill, word } = renderPill("none", false, null);
    expectCssColor(pill.style.backgroundColor, "#f4f4f5"); // surface2
    expectCssColor(word.style.color, "#666666"); // foregroundMuted
  });

  it("stays shrink-safe on the title line (F21's pill posture)", () => {
    const { pill } = renderPill("paseo", false);
    expect(pill.style.flexShrink).toBe("0");
  });
});
