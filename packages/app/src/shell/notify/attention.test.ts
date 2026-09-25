// C11 acceptance: the attention→notify mapping is this pure planner's subject —
// first-scan baseline, the recency floor (two-wave directory patches must not wake
// old agents), one notification per (agent, state), re-fire on a genuinely new
// transition, and the settings-switch gate.
import { describe, expect, it } from "vitest";
import { planAttentionEvents, type AttentionAgentSnapshot, type NotifiedLedger } from "./attention";

function agent(overrides: Partial<AttentionAgentSnapshot> = {}): AttentionAgentSnapshot {
  return {
    key: "srv1:a1",
    serverId: "srv1",
    agentId: "a1",
    workspaceId: "ws1",
    bucket: "running",
    attentionTimestamp: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

const EMPTY: NotifiedLedger = new Map();

function scan(input: {
  enabled?: boolean;
  primed?: boolean;
  fireFrom?: number;
  agents: readonly AttentionAgentSnapshot[];
  notified?: NotifiedLedger;
}) {
  return planAttentionEvents({
    enabled: input.enabled ?? true,
    primed: input.primed ?? true,
    fireFrom: input.fireFrom ?? 0,
    agents: input.agents,
    notified: input.notified ?? EMPTY,
  });
}

describe("planAttentionEvents", () => {
  it("baselines the first scan: waiting agents are recorded, never announced", () => {
    const { events, notified } = scan({
      primed: false,
      agents: [agent({ bucket: "needs_input", attentionTimestamp: 100 })],
    });
    expect(events).toEqual([]);
    expect(notified.get("srv1:a1")).toEqual({ kind: "needs_input", stamp: 100 });
  });

  it("fires once when an agent enters needs_input while running", () => {
    const { events, notified } = scan({
      agents: [agent({ bucket: "needs_input", attentionTimestamp: 200 })],
    });
    expect(events).toEqual([
      {
        key: "srv1:a1",
        serverId: "srv1",
        agentId: "a1",
        workspaceId: "ws1",
        kind: "needs_input",
        stamp: 200,
      },
    ]);
    expect(notified.get("srv1:a1")?.kind).toBe("needs_input");
  });

  it("records but does not announce a stamp below the recency floor", () => {
    // The two-wave case: an OLD failed agent gets its attentionTimestamp patched
    // in after the baseline — new stamp, ancient recency → silent, yet recorded.
    const first = scan({
      primed: false,
      fireFrom: 1000,
      agents: [agent({ bucket: "failed", attentionTimestamp: null, lastActivityAt: 500 })],
    });
    expect(first.events).toEqual([]);
    const second = scan({
      fireFrom: 1000,
      agents: [agent({ bucket: "failed", attentionTimestamp: 900, lastActivityAt: 900 })],
      notified: first.notified,
    });
    expect(second.events).toEqual([]);
    expect(second.notified.get("srv1:a1")).toEqual({ kind: "failed", stamp: 900 });
  });

  it("announces a transition stamped at or after the recency floor", () => {
    const first = scan({
      primed: false,
      fireFrom: 1000,
      agents: [agent({ bucket: "running" })],
    });
    const second = scan({
      fireFrom: 1000,
      agents: [agent({ bucket: "needs_input", attentionTimestamp: 1000 })],
      notified: first.notified,
    });
    expect(second.events).toHaveLength(1);
  });

  it("suppresses the same agent + same state on every later scan", () => {
    const first = scan({ agents: [agent({ bucket: "failed", attentionTimestamp: 300 })] });
    expect(first.events).toHaveLength(1);
    const second = scan({
      agents: [agent({ bucket: "failed", attentionTimestamp: 300 })],
      notified: first.notified,
    });
    expect(second.events).toEqual([]);
    expect(second.notified).toEqual(first.notified);
  });

  it("re-fires on a newer attention request for the same agent", () => {
    const first = scan({ agents: [agent({ bucket: "needs_input", attentionTimestamp: 100 })] });
    const second = scan({
      agents: [agent({ bucket: "needs_input", attentionTimestamp: 250 })],
      notified: first.notified,
    });
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.stamp).toBe(250);
  });

  it("treats needs_input → failed as a new transition", () => {
    const first = scan({ agents: [agent({ bucket: "needs_input", attentionTimestamp: 100 })] });
    const second = scan({
      agents: [agent({ bucket: "failed", attentionTimestamp: 100 })],
      notified: first.notified,
    });
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.kind).toBe("failed");
  });

  it("ignores non-attention buckets and falls back to lastActivityAt without attention", () => {
    const { events, notified } = scan({
      agents: [
        agent({ key: "srv1:run", bucket: "running" }),
        agent({ key: "srv1:done", bucket: "done" }),
        agent({ key: "srv1:att", bucket: "attention" }),
        agent({ key: "srv1:err", bucket: "failed", attentionTimestamp: null, lastActivityAt: 40 }),
      ],
    });
    expect(events.map((event) => event.key)).toEqual(["srv1:err"]);
    expect(events[0]?.stamp).toBe(40);
    expect(notified.has("srv1:run")).toBe(false);
  });

  it("keeps the ledger frozen while the switch is off, then catches up on re-enable", () => {
    const off = scan({
      enabled: false,
      agents: [agent({ bucket: "needs_input", attentionTimestamp: 100 })],
    });
    expect(off.events).toEqual([]);
    expect(off.notified.size).toBe(0);
    // Re-enable: the still-waiting agent is now an unrecorded transition → announced.
    const on = scan({
      agents: [agent({ bucket: "needs_input", attentionTimestamp: 100 })],
      notified: off.notified,
    });
    expect(on.events).toHaveLength(1);
  });

  it("does not re-notify an agent that briefly vanished from the directory", () => {
    const first = scan({ agents: [agent({ bucket: "failed", attentionTimestamp: 400 })] });
    const gone = scan({ agents: [], notified: first.notified });
    const back = scan({
      agents: [agent({ bucket: "failed", attentionTimestamp: 400 })],
      notified: gone.notified,
    });
    expect(back.events).toEqual([]);
  });
});
