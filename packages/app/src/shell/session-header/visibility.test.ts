// C14 acceptance: the session-header visibility predicate and its menu matrix.
// The predicate is the ONLY gate for floating the capsule over the official session
// screen — a false positive is a shell bar on official IA, a false negative is the
// missing P1 feature. Route strings go through the real builders (routes.test.ts
// already guards their round-trips), so this pins the composition.
import { describe, expect, it, vi } from "vitest";
import { OFFICIAL } from "@/shell/routes";
import {
  createSessionHeaderRunner,
  HOST_ROOT_ROUTE,
  SHELL_ROOT_ROUTE,
  resolveShellSessionWorkspace,
  sessionHeaderMenuPlan,
} from "./visibility";

const SESSION_PATH = OFFICIAL.workspace("srv_1", "wks_86ef0");

function input(over: Partial<Parameters<typeof resolveShellSessionWorkspace>[0]> = {}) {
  return {
    shellMode: true,
    pathname: SESSION_PATH,
    rootRoutes: [SHELL_ROOT_ROUTE, HOST_ROOT_ROUTE],
    rootIndex: 1,
    ...over,
  };
}

describe("resolveShellSessionWorkspace", () => {
  it("shows the capsule for a shell-entered official session", () => {
    expect(resolveShellSessionWorkspace(input())).toEqual({
      serverId: "srv_1",
      workspaceId: "wks_86ef0",
    });
  });

  it("shows it with the open intent still on the URL (pre-consume frame)", () => {
    const withIntent = OFFICIAL.agentOpen("srv_1", "wks_86ef0", "agent-9");
    expect(resolveShellSessionWorkspace(input({ pathname: withIntent }))).toEqual({
      serverId: "srv_1",
      workspaceId: "wks_86ef0",
    });
  });

  it("hides outside shell mode (official IA keeps its own chrome)", () => {
    expect(resolveShellSessionWorkspace(input({ shellMode: false }))).toBeNull();
  });

  it("hides when the stack carries no shell provenance (deep link / official sessions)", () => {
    expect(
      resolveShellSessionWorkspace(input({ rootRoutes: [HOST_ROOT_ROUTE], rootIndex: 0 })),
    ).toBeNull();
    // Shell entry ABOVE the host navigator (a second (shell) pushed over the session)
    // means a shell screen is on top, not the session.
    expect(
      resolveShellSessionWorkspace(
        input({ rootRoutes: [SHELL_ROOT_ROUTE, HOST_ROOT_ROUTE, SHELL_ROOT_ROUTE], rootIndex: 2 }),
      ),
    ).toBeNull();
  });

  it("hides on every non-session route", () => {
    for (const pathname of [
      "/chats",
      "/workspace",
      "/me",
      "/settings",
      "/h/srv_1/sessions",
      "/h/srv_1/settings",
      "/h/srv_1/agent/agent-9", // the C4 parse stub is never a session screen
      "/h/srv_1/workspace", // workspace id missing
    ]) {
      expect(resolveShellSessionWorkspace(input({ pathname })), pathname).toBeNull();
    }
  });

  it("keeps hostile workspace ids intact through the predicate", () => {
    const workspaceId = "项目/工作区 100%?#";
    const pathname = OFFICIAL.workspace("srv 1:2", workspaceId);
    expect(resolveShellSessionWorkspace(input({ pathname }))).toEqual({
      serverId: "srv 1:2",
      workspaceId,
    });
  });

  it("hides while a nested route sits deeper than the workspace index", () => {
    // /h/<sid>/workspace/<wid>/plugin/... is not the session screen route.
    const pathname = `${SESSION_PATH}/plugin/p/surface`;
    expect(resolveShellSessionWorkspace(input({ pathname }))).toBeNull();
  });
});

describe("sessionHeaderMenuPlan", () => {
  it("carries 查看项目文件/停止/重命名 in card order", () => {
    expect(sessionHeaderMenuPlan({ stoppable: false }).map((item) => item.id)).toEqual([
      "files",
      "stop",
      "rename",
    ]);
  });

  it("keeps 停止 present-but-disabled unless a turn is abortable (chatMenuPlan spirit)", () => {
    expect(sessionHeaderMenuPlan({ stoppable: false })).toEqual([
      { id: "files", enabled: true },
      { id: "stop", enabled: false },
      { id: "rename", enabled: true },
    ]);
    expect(sessionHeaderMenuPlan({ stoppable: true })).toEqual([
      { id: "files", enabled: true },
      { id: "stop", enabled: true },
      { id: "rename", enabled: true },
    ]);
  });
});

describe("createSessionHeaderRunner (C33 dispatch)", () => {
  // The capsule menu's rows all funnel their id through this table. 重命名 is the
  // row the menu never acts on itself (the C33 rename screen push lives with the
  // caller): it must reach the injected opener and nothing else.
  it("routes 重命名 to the injected screen opener only", () => {
    const openFiles = vi.fn();
    const stop = vi.fn();
    const openRename = vi.fn();
    createSessionHeaderRunner({ openFiles, stop, openRename })("rename");
    expect(openRename).toHaveBeenCalledTimes(1);
    expect(openFiles).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("routes 查看项目文件/停止 to their own callbacks", () => {
    const openFiles = vi.fn();
    const stop = vi.fn();
    const openRename = vi.fn();
    const run = createSessionHeaderRunner({ openFiles, stop, openRename });
    run("files");
    run("stop");
    expect(openFiles).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(openRename).not.toHaveBeenCalled();
  });
});
