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

function pillText(ownership: unknown, externalLooksActive: unknown, origin?: unknown): string {
  cleanup(); // one pill per assertion — tests probe several postures in a row
  render(
    <OwnershipBadge
      ownership={ownership as string | null | undefined}
      externalLooksActive={externalLooksActive as boolean | null | undefined}
      origin={origin as string | null | undefined}
      testID="pill"
    />,
  );
  return screen.getByTestId("pill").textContent ?? "";
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
