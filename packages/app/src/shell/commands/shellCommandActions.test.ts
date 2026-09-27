// C7 acceptance: the command action layer against injected ports — offline hosts are
// refused before any createAgent fires, a successful create navigates exactly once
// with the daemon's agent id, a rejected create reports instead of swallowing, and
// 删除 is gated behind the confirm dialog and lands in the real store singleton.
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

import {
  pendingVisits,
  registerVisitLedgerDeps,
  resetVisitLedger,
  settleVisits,
} from "@/shell/chats/visit-ledger";
import { usePaseoGoCommandsStore, type ShellCommand } from "@/shell/stores/commands";
import {
  createShellCommandActions,
  type ShellCommandClientPort,
} from "@/shell/commands/shellCommandActions";

const command: ShellCommand = {
  id: "cmd-1",
  name: "列出目录结构",
  hostId: "srv-A",
  workspaceId: "ws-1",
  prompt: "列出当前目录结构",
  createdAt: 10,
};

function makeDeps(client: ShellCommandClientPort | null) {
  return {
    deps: {
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}:${JSON.stringify(options)}` : key,
      notify: vi.fn(),
      reportError: vi.fn(),
      getClient: vi.fn(() => client),
      getWorkspaceDirectory: vi.fn(() => "C:/tmp/c5-proj"),
      getPreferredProvider: vi.fn(() => "codex"),
      getAvailableProviders: vi.fn(() => ["codex"]),
      nextClientMessageId: vi.fn(() => "cm-fixed"),
      navigateToAgent: vi.fn(),
      confirm: vi.fn(async () => true),
      haptic: vi.fn(),
    },
  };
}

beforeEach(() => {
  usePaseoGoCommandsStore.setState({ items: [] });
});

describe("run", () => {
  it("refuses an offline host: named error, no createAgent", async () => {
    const { deps } = makeDeps(null);
    await createShellCommandActions(deps).run(command, "ws-1");
    expect(deps.reportError).toHaveBeenCalledWith(
      "commands.errors.runFailed",
      "commands.errors.offline",
    );
    expect(deps.navigateToAgent).not.toHaveBeenCalled();
  });

  it("creates through the official channel and pushes into the new session", async () => {
    const createAgent = vi.fn(async () => ({ id: "agent-9", workspaceId: "ws-1" }));
    const { deps } = makeDeps({ createAgent } as unknown as ShellCommandClientPort);
    await createShellCommandActions(deps).run(command, "ws-1");
    expect(createAgent).toHaveBeenCalledWith({
      config: { provider: "codex", cwd: "C:/tmp/c5-proj" },
      workspaceId: "ws-1",
      initialPrompt: "列出当前目录结构",
      clientMessageId: "cm-fixed",
    });
    expect(deps.navigateToAgent).toHaveBeenCalledWith({
      serverId: "srv-A",
      agentId: "agent-9",
      workspaceId: "ws-1",
    });
  });

  it("reports a rejected create with the daemon's reason and never navigates", async () => {
    const createAgent = vi.fn(async () => {
      throw new Error("provider upstream 502");
    });
    const { deps } = makeDeps({ createAgent } as unknown as ShellCommandClientPort);
    await createShellCommandActions(deps).run(command, "ws-1");
    expect(deps.reportError).toHaveBeenCalledWith(
      "commands.errors.runFailed",
      "provider upstream 502",
    );
    expect(deps.navigateToAgent).not.toHaveBeenCalled();
  });

  // R2-02 regression (指令进入): the successful run navigates into the new session
  // but never recorded the visit — activity watched during it (a fast completion)
  // resurfaced as unread on return, and the row could not even settle its own
  // entry watermark. The run must put the visit on the ledger.
  it("records the visit on a successful run so leaving settles the watched activity", async () => {
    resetVisitLedger();
    const markRead = vi.fn();
    registerVisitLedgerDeps({ lastEventAtOf: () => 5_000, markRead });
    const createAgent = vi.fn(async () => ({ id: "agent-new", workspaceId: "ws-1" }));
    const { deps } = makeDeps({ createAgent } as unknown as ShellCommandClientPort);
    await createShellCommandActions(deps).run(command, "ws-1");
    expect(pendingVisits().map((slot) => slot.key)).toEqual(["srv-A:agent-new"]);
    settleVisits("section-switch"); // leaving the session settles it, floor 0 → fresh
    expect(markRead).toHaveBeenCalledWith("srv-A:agent-new", 5_000);
    resetVisitLedger();
  });

  it("a rejected create records no visit", async () => {
    resetVisitLedger();
    const createAgent = vi.fn(async () => {
      throw new Error("provider upstream 502");
    });
    const { deps } = makeDeps({ createAgent } as unknown as ShellCommandClientPort);
    await createShellCommandActions(deps).run(command, "ws-1");
    expect(pendingVisits()).toHaveLength(0);
  });
});

describe("remove", () => {
  it("keeps the command when the confirm is declined", async () => {
    usePaseoGoCommandsStore.setState({ items: [command] });
    const { deps } = makeDeps(null);
    deps.confirm.mockImplementation(async () => false);
    await createShellCommandActions(deps).remove(command);
    expect(usePaseoGoCommandsStore.getState().items).toHaveLength(1);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("confirms, removes from the store, and reports", async () => {
    usePaseoGoCommandsStore.setState({ items: [command] });
    const { deps } = makeDeps(null);
    await createShellCommandActions(deps).remove(command);
    expect(usePaseoGoCommandsStore.getState().items).toEqual([]);
    expect(deps.notify).toHaveBeenCalledWith('commands.toast.deleted:{"name":"列出目录结构"}');
  });
});
