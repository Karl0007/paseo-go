// B4-OWNERSHIP-UI acceptance (ruling 14 + the RESEARCH grading table): the badge
// and the R4 dialog decisions, as pure functions. The three-state rule is what the
// device frames must show 一眼可辨 — paseo/none wear no badge, external wears one,
// and only a live-looking external writer carries 「运行中」 and the warning.
import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_BADGE_LABEL_KEY,
  decideOwnershipSendWarning,
  ownershipBadgeKind,
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
