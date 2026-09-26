// C30 acceptance 2: the activation matrix (compact × shellMode × full-bleed),
// the full-bleed route matcher and the pathname→section map, all pure (§6 R-1).
import { describe, expect, it } from "vitest";
import {
  isFullBleedPathname,
  shouldActivateTabletSplit,
  tabletSectionForPathname,
} from "./split-predicates";

describe("shouldActivateTabletSplit", () => {
  // Full 2×2×2 truth table: split only on shell ∧ wide ∧ non-full-bleed.
  const rows: [shellActive: boolean, isCompact: boolean, fullBleed: boolean][] = [
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true],
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [false, true, true],
  ];
  it.each(rows)("shell=%s compact=%s fullBleed=%s", (shellActive, isCompact, fullBleed) => {
    expect(shouldActivateTabletSplit({ shellActive, isCompact, fullBleed })).toBe(
      shellActive && !isCompact && !fullBleed,
    );
  });
});

describe("isFullBleedPathname", () => {
  it.each(["/welcome", "/welcome?firstRun=1", "/welcome/x", "/pair-scan", "/pair-scan#cam"])(
    "keeps %s full-window",
    (pathname) => {
      expect(isFullBleedPathname(pathname)).toBe(true);
    },
  );
  it.each([
    "/",
    "/chats",
    "/h/sid/workspace/wid?open=agent:a",
    // prefix guard: a route merely starting with the full-bleed name is not it
    "/welcomed",
    "/pair-scan-me",
  ])("does not claim %s", (pathname) => {
    expect(isFullBleedPathname(pathname)).toBe(false);
  });
});

describe("tabletSectionForPathname", () => {
  it.each([
    ["/chats", "chats"],
    ["/chats?tab=archived", "chats"],
    ["/workspace", "workspace"],
    ["/files/host%3A1/wid", "workspace"],
    ["/files/a/b", "workspace"],
    ["/me", "me"],
  ] as const)("maps %s → %s", (pathname, section) => {
    expect(tabletSectionForPathname(pathname)).toBe(section);
  });

  // null = "hold the previous section" (§3.2-2). The `/h/…` row is the trap the
  // exact-match rule guards: the session route embeds `/workspace/` mid-path.
  it.each([
    "/",
    "/h/sid/workspace/wid",
    "/h/sid/workspace/wid?open=agent:a",
    "/import",
    "/commands/edit",
    "/settings",
  ])("holds across %s", (pathname) => {
    expect(tabletSectionForPathname(pathname)).toBeNull();
  });
});
