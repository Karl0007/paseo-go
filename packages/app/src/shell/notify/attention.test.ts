// C11 acceptance: the attention→notify mapping is this pure planner's subject —
// first-scan baseline, the ledger-only floor (F5), one notification per (agent,
// state), re-fire on a genuinely new transition, the settings-switch gate, and the
// F7 body contract (no error echo in lock-screen text).
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh.json";
import {
  bodyKeyFor,
  planAttentionEvents,
  type AttentionAgentSnapshot,
  type AttentionEvent,
  type NotifiedLedger,
} from "./attention";

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
  agents: readonly AttentionAgentSnapshot[];
  notified?: NotifiedLedger;
}) {
  // Spread forwards vestigial keys (see the F5 test's legacyFloor) so this file
  // also runs red against the pre-fix planner that read `fireFrom`.
  return planAttentionEvents({
    ...(input as object),
    enabled: input.enabled ?? true,
    primed: input.primed ?? true,
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

  it("announces a host behind the device clock: the ledger is the only floor (F5)", () => {
    // The pre-fix hook passed `fireFrom = Date.now()` (device wall clock) and muted
    // every host-issued stamp below it — a host one hour behind was silenced for
    // that whole hour, forever re-recording each transition silently. The floor is
    // now purely ledger-based: no record for this (kind, stamp) → announce.
    const deviceNow = 1_700_000_000_000;
    const hostStamp = deviceNow - 3_600_000;
    const legacyFloor = { fireFrom: deviceNow }; // spread: bypasses excess-property
    const baseline = scan({
      ...legacyFloor,
      primed: false,
      agents: [agent({ bucket: "running" })],
    });
    const scan2 = scan({
      ...legacyFloor,
      agents: [
        agent({ bucket: "failed", attentionTimestamp: hostStamp, lastActivityAt: hostStamp }),
      ],
      notified: baseline.notified,
    });
    expect(scan2.events).toHaveLength(1);
    expect(scan2.events[0]).toMatchObject({ kind: "failed", stamp: hostStamp });
  });

  it("the baseline records each agent's (kind, stamp) so identical later scans stay silent", () => {
    const first = scan({
      primed: false,
      agents: [agent({ bucket: "failed", attentionTimestamp: 900 })],
    });
    expect(first.events).toEqual([]);
    expect(first.notified.get("srv1:a1")).toEqual({ kind: "failed", stamp: 900 });
    const second = scan({
      agents: [agent({ bucket: "failed", attentionTimestamp: 900 })],
      notified: first.notified,
    });
    expect(second.events).toEqual([]);
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

describe("bodyKeyFor (F7: no error echo in notification bodies)", () => {
  const event = (kind: AttentionEvent["kind"]): AttentionEvent => ({
    key: "srv1:a1",
    serverId: "srv1",
    agentId: "a1",
    workspaceId: "ws1",
    kind,
    stamp: 1,
  });

  it("maps kinds to fixed generic body keys", () => {
    expect(bodyKeyFor(event("needs_input"))).toBe("notify.needsInputBody");
    expect(bodyKeyFor(event("failed"))).toBe("notify.failedBody");
  });

  it("no shell locale carries an error-echo body key anymore", () => {
    // lastError can embed local paths / user content; it must never reach the
    // lock screen. The vector is gone with the key itself.
    expect((en.notify as Record<string, unknown>).failedBodyWithError).toBeUndefined();
    expect((zh.notify as Record<string, unknown>).failedBodyWithError).toBeUndefined();
  });
});
