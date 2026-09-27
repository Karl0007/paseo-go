// C3 acceptance: the action layer against a mock client. Local actions must land in
// the real shell stores (the same singletons the screen renders from); daemon actions
// must hit the client port, gate on the confirm dialog, report failures instead of
// swallowing them, and clean up every shell-local record when a chat is deleted.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import {
  chatMenuPlan,
  createShellAgentActions,
  type ShellAgentClientPort,
  type ShellChatTarget,
} from "@/shell/shellAgentActions";

const target: ShellChatTarget = { key: "s1:a1", serverId: "s1", agentId: "a1" };

function makeDeps(client: ShellAgentClientPort | null) {
  return {
    deps: {
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}:${JSON.stringify(options)}` : key,
      notify: vi.fn(),
      reportError: vi.fn(),
      getClient: vi.fn(() => client),
      confirm: vi.fn(async () => true),
      haptic: vi.fn(),
    },
  };
}

/** The port's three RPCs as resolved spies; individual tests override what they need. */
function makeClient() {
  return {
    cancelAgent: vi.fn(async () => {}),
    deleteAgent: vi.fn(async () => {}),
    refreshAgent: vi.fn(async () => ({
      status: "agent_refreshed" as const,
      agentId: "a1",
      requestId: "test-refresh",
    })),
  };
}

beforeEach(() => {
  usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
  usePaseoGoArchiveStore.setState({ archivedIds: [] });
  usePaseoGoReadStateStore.setState({ lastReadAt: {} });
  usePaseoGoForkAckStore.setState({ ackedKeys: [] });
});

describe("local actions", () => {
  it("pin / unpin drive the pins store and report through notify + haptic", () => {
    const { deps } = makeDeps(null);
    const actions = createShellAgentActions(deps);
    actions.pin(target);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1"]);
    expect(deps.notify).toHaveBeenLastCalledWith("chats.toast.pinned");
    actions.pin(target);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1"]);
    actions.unpin(target);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual([]);
    expect(deps.notify).toHaveBeenLastCalledWith("chats.toast.unpinned");
    expect(deps.haptic).toHaveBeenCalledTimes(3);
  });

  it("rename trims into an alias; blank or clearAlias restores the daemon title", () => {
    const { deps } = makeDeps(null);
    const actions = createShellAgentActions(deps);
    actions.rename(target, "  重构对话  ");
    expect(usePaseoGoPinsStore.getState().aliases["s1:a1"]).toBe("重构对话");
    actions.rename(target, "   ");
    expect(usePaseoGoPinsStore.getState().aliases["s1:a1"]).toBeUndefined();
    actions.rename(target, "别名");
    actions.clearAlias(target);
    expect(usePaseoGoPinsStore.getState().aliases).toEqual({});
    expect(deps.notify).toHaveBeenLastCalledWith("chats.toast.aliasCleared");
  });

  it("archive / unarchive drive the archive store", () => {
    const { deps } = makeDeps(null);
    const actions = createShellAgentActions(deps);
    actions.archive(target);
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual(["s1:a1"]);
    actions.unarchive(target);
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual([]);
    expect(deps.notify.mock.calls.map(([message]) => message)).toEqual([
      "chats.toast.archived",
      "chats.toast.unarchived",
    ]);
  });

  it("reorderPinned persists the drag result", () => {
    const { deps } = makeDeps(null);
    createShellAgentActions(deps).reorderPinned(["s1:a2", "s1:a1"]);
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a2", "s1:a1"]);
    expect(deps.haptic).toHaveBeenCalledTimes(1);
  });
});

describe("daemon actions", () => {
  it("stop cancels the agent on the host client", async () => {
    const client = makeClient();
    const { deps } = makeDeps(client);
    await createShellAgentActions(deps).stop(target);
    expect(client.cancelAgent).toHaveBeenCalledWith("a1");
    expect(deps.notify).toHaveBeenCalledWith("chats.toast.stopped");
    expect(deps.reportError).not.toHaveBeenCalled();
  });

  it("stop on an offline host reports instead of throwing", async () => {
    const { deps } = makeDeps(null);
    await createShellAgentActions(deps).stop(target);
    expect(deps.reportError).toHaveBeenCalledWith(
      "chats.errors.actionFailed",
      "chats.errors.hostOffline",
    );
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("stop surfaces a client rejection as an error report", async () => {
    const client = {
      ...makeClient(),
      cancelAgent: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { deps } = makeDeps(client);
    await createShellAgentActions(deps).stop(target);
    expect(deps.reportError).toHaveBeenCalledWith("chats.errors.actionFailed", "boom");
  });

  it("delete asks for confirmation first and does nothing when declined", async () => {
    const client = makeClient();
    const { deps } = makeDeps(client);
    deps.confirm.mockResolvedValueOnce(false);
    await createShellAgentActions(deps).remove(target, "旧对话");
    expect(deps.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, title: "chats.menu.deleteConfirmTitle" }),
    );
    expect(client.deleteAgent).not.toHaveBeenCalled();
  });

  it("delete removes on the daemon and sweeps every shell-local record", async () => {
    const client = makeClient();
    const { deps } = makeDeps(client);
    usePaseoGoPinsStore.setState({ pinnedIds: ["s1:a1"], aliases: { "s1:a1": "别名" } });
    usePaseoGoArchiveStore.setState({ archivedIds: ["s1:a1"] });
    usePaseoGoReadStateStore.setState({ lastReadAt: { "s1:a1": 123, "s1:keep": 456 } });
    usePaseoGoForkAckStore.setState({ ackedKeys: ["s1:a1", "s1:keep"] });

    await createShellAgentActions(deps).remove(target, "旧对话");
    expect(client.deleteAgent).toHaveBeenCalledWith("a1");
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual([]);
    expect(usePaseoGoReadStateStore.getState().lastReadAt).toEqual({ "s1:keep": 456 });
    expect(usePaseoGoForkAckStore.getState().ackedKeys).toEqual(["s1:keep"]);
    expect(deps.notify).toHaveBeenCalledWith("chats.toast.deleted");
  });

  it("a failed delete keeps the local records intact", async () => {
    const client = {
      ...makeClient(),
      deleteAgent: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    const { deps } = makeDeps(client);
    usePaseoGoPinsStore.setState({ pinnedIds: ["s1:a1"], aliases: {} });
    await createShellAgentActions(deps).remove(target, "旧对话");
    expect(deps.reportError).toHaveBeenCalledWith("chats.errors.actionFailed", "nope");
    expect(usePaseoGoPinsStore.getState().pinnedIds).toEqual(["s1:a1"]);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("refresh rehydrates the imported chat on the host and toasts", async () => {
    const client = makeClient();
    const { deps } = makeDeps(client);
    await createShellAgentActions(deps).refresh(target);
    expect(client.refreshAgent).toHaveBeenCalledWith("a1");
    expect(deps.notify).toHaveBeenCalledWith("chats.toast.refreshed");
    expect(deps.reportError).not.toHaveBeenCalled();
  });

  it("refresh on an offline host reports instead of throwing", async () => {
    const { deps } = makeDeps(null);
    await createShellAgentActions(deps).refresh(target);
    expect(deps.reportError).toHaveBeenCalledWith(
      "chats.errors.actionFailed",
      "chats.errors.hostOffline",
    );
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("refresh surfaces a client rejection as an error report", async () => {
    const client = {
      ...makeClient(),
      refreshAgent: vi.fn(async () => {
        throw new Error("rehydrate failed");
      }),
    };
    const { deps } = makeDeps(client);
    await createShellAgentActions(deps).refresh(target);
    expect(deps.reportError).toHaveBeenCalledWith("chats.errors.actionFailed", "rehydrate failed");
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("a second refresh while one is in flight is a silent no-op; after it lands, a new one fires", async () => {
    const reply = { status: "agent_refreshed", agentId: "a1", requestId: "r" } as const;
    type RefreshReply = typeof reply;
    let release: (value: RefreshReply) => void = () => {};
    const client = {
      ...makeClient(),
      refreshAgent: vi.fn(
        () =>
          new Promise<RefreshReply>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const { deps } = makeDeps(client);
    const actions = createShellAgentActions(deps);
    const first = actions.refresh(target);
    await actions.refresh(target); // same key, still in flight → ignored
    expect(client.refreshAgent).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();
    release(reply);
    await first;
    expect(deps.notify).toHaveBeenCalledWith("chats.toast.refreshed");
    const third = actions.refresh(target); // gate released
    release(reply); // the release re-armed on this second RPC too
    await third;
    expect(client.refreshAgent).toHaveBeenCalledTimes(2);
  });
});

describe("chatMenuPlan", () => {
  it("archived rows carry exactly 取消归档/删除 — imported stamps add nothing there", () => {
    expect(
      chatMenuPlan({ pinned: true, archived: true, stoppable: true, imported: false }),
    ).toEqual([
      { id: "unarchive", enabled: true },
      { id: "delete", enabled: true },
    ]);
    expect(chatMenuPlan({ pinned: true, archived: true, stoppable: true, imported: true })).toEqual(
      [
        { id: "unarchive", enabled: true },
        { id: "delete", enabled: true },
      ],
    );
  });

  it("live rows carry the designed actions; pin slot flips with state; no 刷新 without the stamp", () => {
    expect(
      chatMenuPlan({ pinned: false, archived: false, stoppable: true, imported: false }).map(
        (i) => i.id,
      ),
    ).toEqual(["pin", "rename", "archive", "stop", "delete"]);
    expect(
      chatMenuPlan({ pinned: true, archived: false, stoppable: false, imported: false }).map(
        (i) => i.id,
      ),
    ).toEqual(["unpin", "rename", "archive", "stop", "delete"]);
  });

  it("C24: imported live rows gain 刷新 after 停止, before the 删除 rule", () => {
    expect(
      chatMenuPlan({ pinned: false, archived: false, stoppable: false, imported: true }),
    ).toEqual([
      { id: "pin", enabled: true },
      { id: "rename", enabled: true },
      { id: "archive", enabled: true },
      { id: "stop", enabled: false },
      { id: "refresh", enabled: true },
      { id: "delete", enabled: true },
    ]);
  });

  it("停止 is only enabled for an abortable turn", () => {
    const running = chatMenuPlan({
      pinned: false,
      archived: false,
      stoppable: true,
      imported: false,
    });
    const idle = chatMenuPlan({
      pinned: false,
      archived: false,
      stoppable: false,
      imported: false,
    });
    expect(running.find((i) => i.id === "stop")?.enabled).toBe(true);
    expect(idle.find((i) => i.id === "stop")?.enabled).toBe(false);
  });
});
