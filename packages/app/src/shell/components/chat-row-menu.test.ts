// C33 acceptance: the row menu's dispatch table. Every menu row funnels its action
// id through `createChatMenuRunner`; 重命名 is the one row the menu must NOT act on
// itself — it hands the target to the injected screen opener (the (shell)/rename
// push lives with the caller), never touching `actions.rename`. The other rows keep
// the C3 semantics (the plan itself is pinned in shellAgentActions.test.ts).
import { describe, expect, it, vi } from "vitest";

// The runner test never mounts a surface; mock the engine so the module loads
// without the menu stack (context-menu.test.tsx idiom).
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
  ContextMenuSeparator: () => null,
}));

import { createChatMenuRunner } from "@/shell/components/chat-row-menu";
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";

const target: ShellChatTarget = { key: "s1:a1", serverId: "s1", agentId: "a1" };

function makeActions(): ShellAgentActions {
  return {
    pin: vi.fn(),
    unpin: vi.fn(),
    rename: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    stop: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    reorderPinned: vi.fn(),
  };
}

describe("createChatMenuRunner", () => {
  it("重命名 routes to the injected screen opener with the target, never to actions", () => {
    const actions = makeActions();
    const openRename = vi.fn();
    createChatMenuRunner({ actions, target, displayTitle: "T", openRename })("rename");
    expect(openRename).toHaveBeenCalledWith(target);
    expect(actions.rename).not.toHaveBeenCalled();
  });

  it("the acting rows keep their C3 wiring", () => {
    const actions = makeActions();
    const openRename = vi.fn();
    const run = createChatMenuRunner({ actions, target, displayTitle: "标题", openRename });
    run("pin");
    run("unpin");
    run("archive");
    run("unarchive");
    run("stop");
    run("refresh");
    run("delete");
    expect(actions.pin).toHaveBeenCalledWith(target);
    expect(actions.unpin).toHaveBeenCalledWith(target);
    expect(actions.archive).toHaveBeenCalledWith(target);
    expect(actions.unarchive).toHaveBeenCalledWith(target);
    expect(actions.stop).toHaveBeenCalledWith(target);
    // C24: 刷新 fires the action layer (client.refreshAgent + toast live there).
    expect(actions.refresh).toHaveBeenCalledWith(target);
    // 删除确认 carries the display title, not the alias-less key.
    expect(actions.remove).toHaveBeenCalledWith(target, "标题");
  });
});
