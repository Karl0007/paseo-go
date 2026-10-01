// B4-OWNERSHIP-UI acceptance (ruling 14 + the RESEARCH grading table), the
// B5-OWNVIS tri-state (F16/D19) and the B6-OWN-HEAL birth axis (F19/D22): the pill
// presentation and the R4 dialog decisions, as pure functions. B4's rule was the
// WARNING badge (paseo/none wore nothing); F16 makes the axis always visible — every
// posture renders a word, and only a live-looking external writer carries 「运行中」
// and the warning tone. D22 adds the third input: with no live writer in evidence
// the pill answers 原生/外部 from how the session was born.
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

describe("ownershipPresentation 三轴判定 (B6-OWN-HEAL F19/D22)", () => {
  const native = {
    state: "native",
    labelKey: OWNERSHIP_STATE_LABEL_KEY.native,
    tone: "neutral",
  } as const;
  const unknown = {
    state: "unknown",
    labelKey: OWNERSHIP_STATE_LABEL_KEY.unknown,
    tone: "outline",
  } as const;
  const externalIdle = {
    state: "external",
    labelKey: OWNERSHIP_BADGE_LABEL_KEY.external,
    tone: "warning",
  } as const;

  it("answers an idle session by its birth: launch → 原生, import → 外部", () => {
    // The F19 bug lived here: pre-B4 records project `none`, and `none` alone used to
    // mean 未知 for the rest of their life — a whole list of pills saying nothing.
    for (const ownership of ["none", null, undefined] as const) {
      expect(
        ownershipPresentation({ ownership, externalLooksActive: false, origin: "launch" }),
      ).toEqual(native);
      expect(
        ownershipPresentation({ ownership, externalLooksActive: null, origin: "import" }),
      ).toEqual(externalIdle);
    }
  });

  it("keeps 未知 for exactly the unknowable posture: no ownership pair AND no birth", () => {
    expect(
      ownershipPresentation({ ownership: "none", externalLooksActive: null, origin: null }),
    ).toEqual(unknown);
    // A pre-go.7 host (both axes absent) is still honestly 未知.
    expect(
      ownershipPresentation({
        ownership: undefined,
        externalLooksActive: undefined,
        origin: undefined,
      }),
    ).toEqual(unknown);
    // An origin value this build does not know is not a licence to guess either.
    expect(
      ownershipPresentation({ ownership: "none", externalLooksActive: false, origin: "teleport" }),
    ).toEqual(unknown);
  });

  it("never lets birth overwrite live evidence", () => {
    // The daemon holds an imported session → it IS native right now.
    expect(
      ownershipPresentation({ ownership: "paseo", externalLooksActive: false, origin: "import" }),
    ).toEqual(native);
    // A foreign write beats a launch birth, with B4's live-writer split intact.
    expect(
      ownershipPresentation({ ownership: "external", externalLooksActive: true, origin: "launch" }),
    ).toEqual({
      state: "external",
      labelKey: OWNERSHIP_BADGE_LABEL_KEY.externalActive,
      tone: "warning",
    });
    expect(
      ownershipPresentation({
        ownership: "external",
        externalLooksActive: false,
        origin: "launch",
      }),
    ).toEqual(externalIdle);
  });

  it("birth-inferred 外部 never claims 运行中", () => {
    // `externalLooksActive` is only ever a statement about an OBSERVED writer; an
    // adopted-but-idle session has none, however the companion bit arrives.
    expect(
      ownershipPresentation({ ownership: "none", externalLooksActive: true, origin: "import" }),
    ).toEqual(externalIdle);
  });

  it("leaves the guard's question untouched (D22: 发送守卫语义不改)", () => {
    // Why `origin` is optional on OwnershipFacts: an idle imported session reads 外部
    // on the pill and still sends straight through — 空闲 import ≠ 运行中.
    const facts = { ownership: "none", externalLooksActive: false, origin: "import" } as const;
    expect(ownershipBadgeKind(facts)).toBeNull();
    expect(decideOwnershipSendWarning({ ...facts, provider: "omp" })).toBe("pass");
  });
});
