// B4-OWNERSHIP-UI acceptance (ruling 14 + the RESEARCH grading table) and the
// B5-OWNVIS tri-state (F16/D19): the pill presentation and the R4 dialog
// decisions, as pure functions. B4's rule was the WARNING badge (paseo/none wore
// nothing); F16 makes the axis always visible — every posture renders a word,
// and only a live-looking external writer carries 「运行中」 and the warning tone.
import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_BADGE_LABEL_KEY,
  OWNERSHIP_STATE_LABEL_KEY,
  decideOwnershipSendWarning,
  ownershipBadgeKind,
  ownershipPresentation,
} from "./ownership";

describe("ownershipBadgeKind", () => {
  it("badges only external — paseo, none and a pre-go.7 daemon (undefined) wear none", () => {
    expect(ownershipBadgeKind({ ownership: "paseo", externalLooksActive: true })).toBeNull();
    expect(ownershipBadgeKind({ ownership: "none", externalLooksActive: true })).toBeNull();
    expect(ownershipBadgeKind({ ownership: undefined, externalLooksActive: undefined })).toBeNull();
    expect(ownershipBadgeKind({ ownership: null, externalLooksActive: null })).toBeNull();
  });

  it("splits external by the live-writer companion (undefined/null read as false)", () => {
    expect(ownershipBadgeKind({ ownership: "external", externalLooksActive: true })).toBe(
      "externalActive",
    );
    expect(ownershipBadgeKind({ ownership: "external", externalLooksActive: false })).toBe(
      "external",
    );
    expect(ownershipBadgeKind({ ownership: "external", externalLooksActive: undefined })).toBe(
      "external",
    );
    expect(ownershipBadgeKind({ ownership: "external", externalLooksActive: null })).toBe(
      "external",
    );
  });

  it("maps both variants to shell-namespace label keys", () => {
    expect(OWNERSHIP_BADGE_LABEL_KEY.external).toBe("chats.ownership.badge");
    expect(OWNERSHIP_BADGE_LABEL_KEY.externalActive).toBe("chats.ownership.badgeActive");
  });
});

describe("decideOwnershipSendWarning (RESEARCH 结论 2, batch-4 unified dialog)", () => {
  const live = { ownership: "external", externalLooksActive: true } as const;

  it("warns for the fork-capable writers (claude/omp/pi and unknown providers)", () => {
    for (const provider of ["claude", "omp", "pi", "future-agent"]) {
      expect(decideOwnershipSendWarning({ ...live, provider })).toBe("warn");
    }
  });

  it("weakens the body for codex (linear log: nothing lost, but unseen)", () => {
    expect(decideOwnershipSendWarning({ ...live, provider: "codex" })).toBe("warnWeak");
  });

  it("passes opencode straight through (shared DB, the dialog is pure noise)", () => {
    expect(decideOwnershipSendWarning({ ...live, provider: "opencode" })).toBe("pass");
  });

  it("passes whenever the badge would not read 运行中", () => {
    expect(
      decideOwnershipSendWarning({
        ownership: "external",
        externalLooksActive: false,
        provider: "omp",
      }),
    ).toBe("pass");
    expect(
      decideOwnershipSendWarning({
        ownership: "external",
        externalLooksActive: undefined,
        provider: "omp",
      }),
    ).toBe("pass");
    expect(
      decideOwnershipSendWarning({
        ownership: "paseo",
        externalLooksActive: true,
        provider: "omp",
      }),
    ).toBe("pass");
    expect(
      decideOwnershipSendWarning({
        ownership: undefined,
        externalLooksActive: undefined,
        provider: "omp",
      }),
    ).toBe("pass");
  });
});

describe("ownershipPresentation (B5-OWNVIS F16/D19 三态判定)", () => {
  it("maps the protocol union to the three visible states", () => {
    expect(ownershipPresentation({ ownership: "paseo", externalLooksActive: false })).toEqual({
      state: "native",
      labelKey: OWNERSHIP_STATE_LABEL_KEY.native,
      tone: "neutral",
    });
    expect(ownershipPresentation({ ownership: "none", externalLooksActive: null })).toEqual({
      state: "unknown",
      labelKey: OWNERSHIP_STATE_LABEL_KEY.unknown,
      tone: "outline",
    });
    // A pre-go.7 daemon (undefined pair) is honestly 未知, never a silent pill.
    expect(ownershipPresentation({ ownership: undefined, externalLooksActive: undefined })).toEqual(
      { state: "unknown", labelKey: OWNERSHIP_STATE_LABEL_KEY.unknown, tone: "outline" },
    );
  });

  it("external keeps the B4 warning story and the live-writer split", () => {
    expect(ownershipPresentation({ ownership: "external", externalLooksActive: true })).toEqual({
      state: "external",
      labelKey: OWNERSHIP_BADGE_LABEL_KEY.externalActive,
      tone: "warning",
    });
    expect(ownershipPresentation({ ownership: "external", externalLooksActive: false })).toEqual({
      state: "external",
      labelKey: OWNERSHIP_BADGE_LABEL_KEY.external,
      tone: "warning",
    });
  });

  it("never flags 运行中 outside external (the companion only grades external)", () => {
    for (const ownership of ["paseo", "none", null, undefined] as const) {
      const view = ownershipPresentation({ ownership, externalLooksActive: true });
      expect(view.labelKey).not.toBe(OWNERSHIP_BADGE_LABEL_KEY.externalActive);
      expect(view.tone).not.toBe("warning");
    }
  });
});
