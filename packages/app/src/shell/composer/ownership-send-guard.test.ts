// R4 send guard wiring (B4-OWNERSHIP-UI): the wrapper around the runtime client's
// sendAgentMessage. The contract the device round replays: a direct composer send
// into external+looksActive asks first (仍要发送 sends verbatim, 取消 throws the
// official submit path's restore-input error); a background queue drain, a
// shell-off app, a dead-looking writer, or opencode never sees a dialog; and a
// re-install (language change) must never ask twice for one send.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

// Shared doubles for the module seams the guard reads. vi.hoisted: the mock
// factories run during import resolution, before this module's body.
const h = vi.hoisted(() => ({
  // hosts → clients, as the runtime store hands them out.
  clients: new Map<string, { sendAgentMessage: Mock }>(),
  storeListeners: new Set<() => void>(),
  // The directory the guard reads agent facts from (server s1). Values carry the
  // same shape the real Agent rows do; the guard reads them through its own mock.
  agents: new Map<string, unknown>(),
  shellActive: true,
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => [...h.clients.keys()].map((serverId) => ({ serverId })),
    getClient: (serverId: string) => h.clients.get(serverId) ?? null,
    subscribeAll: (listener: () => void) => {
      h.storeListeners.add(listener);
      return () => {
        h.storeListeners.delete(listener);
      };
    },
  }),
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: { s1: { agents: h.agents } } }) },
}));

vi.mock("@/shell/stores/settings", () => ({
  usePaseoGoSettingsStore: { getState: () => ({ shellMode: h.shellActive }) },
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

import { confirmDialog } from "@/utils/confirm-dialog";
import {
  confirmOwnershipSend,
  installOwnershipSendGuard,
  type GuardAgentFacts,
} from "@/shell/composer/ownership-send-guard";

const t = (key: string) => key;
const deps = { t, confirm: confirmDialog };

function agentFacts(overrides: Partial<GuardAgentFacts> = {}): GuardAgentFacts {
  return { provider: "omp", ownership: "external", externalLooksActive: true, ...overrides };
}

function makeClient() {
  return { sendAgentMessage: vi.fn(async (..._args: unknown[]) => {}) };
}

beforeEach(() => {
  h.clients.clear();
  h.agents.clear();
  h.storeListeners.clear();
  h.shellActive = true;
  vi.mocked(confirmDialog).mockClear();
  vi.mocked(confirmDialog).mockResolvedValue(true);
});

describe("confirmOwnershipSend (the grading seam)", () => {
  it("passes a background drain (no activeTurnBehavior) without asking", async () => {
    const result = await confirmOwnershipSend(deps, agentFacts(), false);
    expect(result).toEqual({ proceed: true, warned: false });
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it("asks with the standard body for claude/omp/pi and 仍要发送 proceeds", async () => {
    const result = await confirmOwnershipSend(deps, agentFacts({ provider: "claude" }), true);
    expect(result).toEqual({ proceed: true, warned: true });
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "chats.ownership.sendTitle",
        message: "chats.ownership.sendBody",
        confirmLabel: "chats.ownership.sendConfirm",
        cancelLabel: "chats.ownership.sendCancel",
      }),
    );
  });

  it("asks codex with the weakened body", async () => {
    const result = await confirmOwnershipSend(deps, agentFacts({ provider: "codex" }), true);
    expect(result.warned).toBe(true);
    expect(vi.mocked(confirmDialog).mock.calls[0]?.[0]?.message).toBe(
      "chats.ownership.sendBodyCodex",
    );
  });

  it("never asks opencode, a dead-looking writer, a paseo-owned session, or a lost agent", async () => {
    expect(
      (await confirmOwnershipSend(deps, agentFacts({ provider: "opencode" }), true)).warned,
    ).toBe(false);
    expect(
      (await confirmOwnershipSend(deps, agentFacts({ externalLooksActive: false }), true)).warned,
    ).toBe(false);
    expect(
      (await confirmOwnershipSend(deps, agentFacts({ ownership: "paseo" }), true)).warned,
    ).toBe(false);
    expect((await confirmOwnershipSend(deps, null, true)).warned).toBe(false);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it("reports cancel as proceed:false (the wrapper turns that into the restore note)", async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    expect(await confirmOwnershipSend(deps, agentFacts(), true)).toEqual({
      proceed: false,
      warned: true,
    });
  });
});

describe("installOwnershipSendGuard (the client wrapper)", () => {
  it("guards current AND later clients; 仍要发送 forwards the exact call", async () => {
    const first = makeClient();
    const firstOriginal = first.sendAgentMessage;
    h.clients.set("s1", first);
    h.agents.set("a1", agentFacts());
    const dispose = installOwnershipSendGuard(deps);

    const later = makeClient();
    const laterOriginal = later.sendAgentMessage;
    h.clients.set("s2", later);
    for (const listener of h.storeListeners) listener();

    const options = { messageId: "m1", activeTurnBehavior: "interrupt" };
    await first.sendAgentMessage("a1", "hello", options);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(firstOriginal).toHaveBeenCalledWith("a1", "hello", options);

    await later.sendAgentMessage("a1", "reconnected", { activeTurnBehavior: "steer" });
    expect(confirmDialog).toHaveBeenCalledTimes(2);
    expect(laterOriginal).toHaveBeenCalledWith("a1", "reconnected", {
      activeTurnBehavior: "steer",
    });
    dispose();
  });

  it("取消 throws the localized note and never reaches the daemon", async () => {
    const client = makeClient();
    const original = client.sendAgentMessage;
    h.clients.set("s1", client);
    h.agents.set("a1", agentFacts());
    const dispose = installOwnershipSendGuard(deps);
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);

    await expect(
      client.sendAgentMessage("a1", "hi", { activeTurnBehavior: "interrupt" }),
    ).rejects.toThrow("chats.ownership.sendCancelled");
    expect(original).not.toHaveBeenCalled();
    dispose();
  });

  it("forwards a background drain and a shell-off send untouched", async () => {
    const client = makeClient();
    const original = client.sendAgentMessage;
    h.clients.set("s1", client);
    h.agents.set("a1", agentFacts());
    const dispose = installOwnershipSendGuard(deps);

    await client.sendAgentMessage("a1", "drained", { messageId: "m9" });
    expect(original).toHaveBeenCalledWith("a1", "drained", { messageId: "m9" });
    expect(confirmDialog).not.toHaveBeenCalled();

    h.shellActive = false;
    await client.sendAgentMessage("a1", "official app", { activeTurnBehavior: "interrupt" });
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("re-install (language change) never asks twice for one send", async () => {
    const client = makeClient();
    h.clients.set("s1", client);
    h.agents.set("a1", agentFacts());
    const disposeA = installOwnershipSendGuard(deps);
    const disposeB = installOwnershipSendGuard({ ...deps });
    disposeA();

    await client.sendAgentMessage("a1", "hi", { activeTurnBehavior: "interrupt" });
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    disposeB();
  });
});
