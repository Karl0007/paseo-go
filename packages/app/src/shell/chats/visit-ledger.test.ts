// R2-02/R2-03 acceptance: the visit ledger is the module-level home of the C18
// 双拍's second beat. The invariants that matter:
//   · 多槽 — visits recorded under different row keys coexist (B never overwrites
//     A) and each keeps its own section attribution;
//   · 结算时点 — settle stamps lastEventAtOf AT THE SETTLE MOMENT (leave-settles),
//     floored at the slot's entry stamp (host clock can step back);
//   · 结算幂等 — a settled slot is gone: a later beat stamps nothing, so activity
//     that lands AFTER leaving re-arms unread instead of being swallowed;
//   · 残留补偿 — a slot whose directory row is absent (undefined = not loaded /
//     R2-14 garbage dates) survives a settle untouched and stamps on a later one;
//   · recordVisit 自带离开语义 — opening another session settles the previous
//     slots first (the switch IS the leave action for the earlier visit);
//   · 无 deps 不炸 — settle before any opener registered is a loud no-op.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pendingVisits,
  recordVisit,
  registerVisitLedgerDeps,
  resetVisitLedger,
  settleVisits,
  type VisitSlot,
} from "./visit-ledger";

const ENTRY_A = 1_000;
const ENTRY_B = 2_000;

function slotA(overrides: Partial<VisitSlot> = {}): VisitSlot {
  return {
    section: "chats",
    key: "srv-1:agent-9",
    serverId: "srv-1",
    agentId: "agent-9",
    at: ENTRY_A,
    ...overrides,
  };
}

function slotB(): VisitSlot {
  return {
    section: "workspace",
    key: "host:2:agent-3", // server ids may contain ':' — the ledger keys by row key
    serverId: "host:2",
    agentId: "agent-3",
    at: ENTRY_B,
  };
}

/** Fresh ledger + a deps pair the tests drive by hand. */
function harness(fresh: () => number | undefined = () => 5_000) {
  resetVisitLedger();
  const markRead = vi.fn();
  const lastEventAtOf = vi.fn(() => fresh());
  registerVisitLedgerDeps({ lastEventAtOf, markRead });
  return { markRead, lastEventAtOf };
}

beforeEach(() => {
  resetVisitLedger();
});

describe("visit ledger", () => {
  it("keeps multi-section slots and settles each with its own watermark", () => {
    // Multi-slot coexistence: A's row is not in the directory yet (its settle
    // survives), so recording B must NOT drop A — both pending, own sections.
    let aLoaded = false;
    const markRead = vi.fn();
    const lastEventAtOf = vi.fn((serverId: string) =>
      serverId === "srv-1" && !aLoaded ? undefined : 5_000,
    );
    registerVisitLedgerDeps({ lastEventAtOf, markRead });
    recordVisit(slotA());
    recordVisit(slotB());
    expect(
      pendingVisits()
        .map((v) => v.key)
        .sort(),
    ).toEqual(["host:2:agent-3", "srv-1:agent-9"]);
    // section 归属: each slot remembers who recorded it.
    expect(pendingVisits().find((v) => v.key === "srv-1:agent-9")?.section).toBe("chats");
    expect(pendingVisits().find((v) => v.key === "host:2:agent-3")?.section).toBe("workspace");

    aLoaded = true;
    const report = settleVisits("section-switch");
    expect([...report].sort()).toEqual(["host:2:agent-3", "srv-1:agent-9"]);
    expect(markRead).toHaveBeenCalledWith("srv-1:agent-9", 5_000);
    expect(markRead).toHaveBeenCalledWith("host:2:agent-3", 5_000);
    expect(pendingVisits()).toHaveLength(0);
  });

  it("settle is idempotent: a drained slot is never re-stamped by a later beat", () => {
    const { markRead } = harness();
    recordVisit(slotA());
    settleVisits("section-switch");
    settleVisits("focus-return");
    settleVisits("focus-return");
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("never lowers the watermark below the entry stamp (host clock step-back)", () => {
    const { markRead } = harness(() => ENTRY_A - 10_000);
    recordVisit(slotA());
    settleVisits("focus-return");
    expect(markRead).toHaveBeenCalledWith(slotA().key, ENTRY_A);
  });

  it("残留补偿: an absent directory row keeps the slot; a later settle stamps it", () => {
    let loaded = false;
    const { markRead } = harness(() => (loaded ? 7_000 : undefined));
    recordVisit(slotA());
    expect(settleVisits("focus-return")).toHaveLength(0);
    expect(markRead).not.toHaveBeenCalled();
    expect(pendingVisits()).toHaveLength(1); // slot survived, nothing bogus stamped
    loaded = true;
    expect(settleVisits("focus-return")).toEqual([slotA().key]);
    expect(markRead).toHaveBeenCalledWith(slotA().key, 7_000);
  });

  it("re-record settles the previous slots first — the switch is the leave moment", () => {
    const clock = { now: 4_000 };
    const { markRead } = harness(() => clock.now);
    recordVisit(slotA());
    clock.now = 4_500; // activity watched inside A's visit
    recordVisit(slotB()); // entering B = leaving A → A settles NOW, at 4_500
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(slotA().key, 4_500);
    expect(pendingVisits().map((v) => v.key)).toEqual([slotB().key]);
    clock.now = 9_000; // activity AFTER leaving A must not land on A
    settleVisits("section-switch");
    expect(markRead).toHaveBeenCalledWith(slotB().key, 9_000);
    expect(markRead).not.toHaveBeenCalledWith(slotA().key, 9_000);
  });

  it("re-recording the same key settles the old visit and keeps the new slot", () => {
    const { markRead } = harness(() => 4_000);
    recordVisit(slotA());
    recordVisit(slotA({ at: 3_000 }));
    expect(markRead).toHaveBeenCalledTimes(1); // old visit settled, new one pending
    expect(pendingVisits()).toHaveLength(1);
    expect(pendingVisits()[0]?.at).toBe(3_000);
  });

  it("without registered deps settle is a loud no-op and the slots survive", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetVisitLedger(); // no registerVisitLedgerDeps call
    recordVisit(slotA());
    expect(settleVisits("section-switch")).toHaveLength(0);
    expect(warn).toHaveBeenCalled(); // the stranded settle is loud, never silent
    expect(pendingVisits()).toHaveLength(1);
    const markRead = vi.fn();
    registerVisitLedgerDeps({ lastEventAtOf: () => 6_000, markRead });
    expect(settleVisits("focus-return")).toEqual([slotA().key]);
    expect(markRead).toHaveBeenCalledWith(slotA().key, 6_000);
    warn.mockRestore();
  });
});
