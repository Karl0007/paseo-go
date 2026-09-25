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

beforeEach(() => {
  usePaseoGoPinsStore.setState({ pinnedIds: [], aliases: {} });
  usePaseoGoArchiveStore.setState({ archivedIds: [] });
  usePaseoGoReadStateStore.setState({ lastReadAt: {} });
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
    const client = { cancelAgent: vi.fn(async () => {}), deleteAgent: vi.fn(async () => {}) };
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
      cancelAgent: vi.fn(async () => {
        throw new Error("boom");
      }),
      deleteAgent: vi.fn(async () => {}),
    };
    const { deps } = makeDeps(client);
    await createShellAgentActions(deps).stop(target);
    expect(deps.reportError).toHaveBeenCalledWith("chats.errors.actionFailed", "boom");
  });

  it("delete asks for confirmation first and does nothing when declined", async () => {
    const client = { cancelAgent: vi.fn(async () => {}), deleteAgent: vi.fn(async () => {}) };
    const { deps } = makeDeps(client);
    deps.confirm.mockResolvedValueOnce(false);
    await createShellAgentActions(deps).remove(target, "旧对话");
    expect(deps.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, title: "chats.menu.deleteConfirmTitle" }),
    );
    expect(client.deleteAgent).not.toHaveBeenCalled();
  });

  it("delete removes on the daemon and sweeps every shell-local record", async () => {
    const client = { cancelAgent: vi.fn(async () => {}), deleteAgent: vi.fn(async () => {}) };
    const { deps } = makeDeps(client);
    usePaseoGoPinsStore.setState({ pinnedIds: ["s1:a1"], aliases: { "s1:a1": "别名" } });
    usePaseoGoArchiveStore.setState({ archivedIds: ["s1:a1"] });
    usePaseoGoReadStateStore.setState({ lastReadAt: { "s1:a1": 123, "s1:keep": 456 } });

    await createShellAgentActions(deps).remove(target, "旧对话");
    expect(client.deleteAgent).toHaveBeenCalledWith("a1");
    expect(usePaseoGoPinsStore.getState()).toMatchObject({ pinnedIds: [], aliases: {} });
    expect(usePaseoGoArchiveStore.getState().archivedIds).toEqual([]);
    expect(usePaseoGoReadStateStore.getState().lastReadAt).toEqual({ "s1:keep": 456 });
    expect(deps.notify).toHaveBeenCalledWith("chats.toast.deleted");
  });

  it("a failed delete keeps the local records intact", async () => {
    const client = {
      cancelAgent: vi.fn(async () => {}),
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
});

describe("chatMenuPlan", () => {
  it("archived rows carry exactly 取消归档/删除", () => {
    expect(chatMenuPlan({ pinned: true, archived: true, stoppable: true })).toEqual([
      { id: "unarchive", enabled: true },
      { id: "delete", enabled: true },
    ]);
  });

  it("live rows carry the five actions; pin slot flips with state", () => {
    expect(
      chatMenuPlan({ pinned: false, archived: false, stoppable: true }).map((i) => i.id),
    ).toEqual(["pin", "rename", "archive", "stop", "delete"]);
    expect(
      chatMenuPlan({ pinned: true, archived: false, stoppable: false }).map((i) => i.id),
    ).toEqual(["unpin", "rename", "archive", "stop", "delete"]);
  });

  it("停止 is only enabled for an abortable turn", () => {
    const running = chatMenuPlan({ pinned: false, archived: false, stoppable: true });
    const idle = chatMenuPlan({ pinned: false, archived: false, stoppable: false });
    expect(running.find((i) => i.id === "stop")?.enabled).toBe(true);
    expect(idle.find((i) => i.id === "stop")?.enabled).toBe(false);
  });
});
