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

  it("yields the top band while the compact explorer overlay is open (C21)", () => {
    expect(resolveShellSessionWorkspace(input({ explorerOverlayOpen: true }))).toBeNull();
    // The yield is an extra gate only: every other bucket keeps its verdict.
    expect(resolveShellSessionWorkspace(input({ explorerOverlayOpen: false }))).toEqual({
      serverId: "srv_1",
      workspaceId: "wks_86ef0",
    });
    expect(
      resolveShellSessionWorkspace(input({ shellMode: false, explorerOverlayOpen: true })),
    ).toBeNull();
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
  // C21 matrix: the capsule ⋯ aggregates the official header's right cluster.
  // Order is the card's; every gate is present-but-disabled (the 停止 precedent),
  // never a hidden row, so the menu's shape is stable across states.
  it("carries 查看项目文件/查看 diff/查看文件/运行脚本/停止/重命名 in card order", () => {
    expect(
      sessionHeaderMenuPlan({
        stoppable: false,
        hasScripts: false,
        isGit: false,
        hasCheckout: false,
      }).map((item) => item.id),
    ).toEqual(["files", "diff", "explorer", "scripts", "stop", "rename"]);
  });

  it("keeps 停止 present-but-disabled unless a turn is abortable (chatMenuPlan spirit)", () => {
    const enabled = sessionHeaderMenuPlan({
      stoppable: true,
      hasScripts: true,
      isGit: true,
      hasCheckout: true,
    });
    const disabled = sessionHeaderMenuPlan({
      stoppable: false,
      hasScripts: true,
      isGit: true,
      hasCheckout: true,
    });
    expect(enabled.find((item) => item.id === "stop")?.enabled).toBe(true);
    expect(disabled.find((item) => item.id === "stop")?.enabled).toBe(false);
  });

  it("gates the aggregated rows: diff needs git+checkout, explorer needs checkout, scripts needs scripts", () => {
    const none = sessionHeaderMenuPlan({
      stoppable: false,
      hasScripts: false,
      isGit: false,
      hasCheckout: false,
    });
    expect(none).toEqual([
      { id: "files", enabled: true },
      { id: "diff", enabled: false },
      { id: "explorer", enabled: false },
      { id: "scripts", enabled: false },
      { id: "stop", enabled: false },
      { id: "rename", enabled: true },
    ]);
    // Each single-factor flip opens exactly its own row(s).
    const gitOnly = sessionHeaderMenuPlan({
      stoppable: false,
      hasScripts: false,
      isGit: true,
      hasCheckout: false,
    });
    expect(gitOnly.find((item) => item.id === "diff")?.enabled).toBe(false); // no directory
    const checkoutOnly = sessionHeaderMenuPlan({
      stoppable: false,
      hasScripts: false,
      isGit: false,
      hasCheckout: true,
    });
    expect(checkoutOnly).toEqual([
      { id: "files", enabled: true },
      { id: "diff", enabled: false }, // not a git checkout
      { id: "explorer", enabled: true },
      { id: "scripts", enabled: false },
      { id: "stop", enabled: false },
      { id: "rename", enabled: true },
    ]);
    const scriptsOnly = sessionHeaderMenuPlan({
      stoppable: false,
      hasScripts: true,
      isGit: false,
      hasCheckout: false,
    });
    expect(scriptsOnly.find((item) => item.id === "scripts")?.enabled).toBe(true);
    expect(scriptsOnly.find((item) => item.id === "explorer")?.enabled).toBe(false);
  });

  it("pins the full 2×2×2×2 bucket matrix", () => {
    const rows: Array<[boolean, boolean, boolean, boolean]> = [];
    for (const stoppable of [false, true]) {
      for (const hasScripts of [false, true]) {
        for (const isGit of [false, true]) {
          for (const hasCheckout of [false, true]) {
            rows.push([stoppable, hasScripts, isGit, hasCheckout]);
          }
        }
      }
    }
    for (const [stoppable, hasScripts, isGit, hasCheckout] of rows) {
      expect(
        sessionHeaderMenuPlan({ stoppable, hasScripts, isGit, hasCheckout }).map((item) => [
          item.id,
          item.enabled,
        ]),
      ).toEqual([
        ["files", true],
        ["diff", isGit && hasCheckout],
        ["explorer", hasCheckout],
        ["scripts", hasScripts],
        ["stop", stoppable],
        ["rename", true],
      ]);
    }
  });
});

describe("createSessionHeaderRunner (C33 dispatch, C21 extension)", () => {
  // The capsule menu's actionable rows all funnel their id through this table.
  // 重命名 is the row the menu never acts on itself (the C33 rename screen push
  // lives with the caller): it must reach the injected opener and nothing else.
  // 运行脚本 is not dispatchable at all (its type is excluded) — the subpage's
  // rows fire the RPCs themselves.
  function makeDeps() {
    return {
      openFiles: vi.fn(),
      openDiff: vi.fn(),
      openExplorer: vi.fn(),
      stop: vi.fn(),
      openRename: vi.fn(),
    };
  }

  it("routes 重命名 to the injected screen opener only", () => {
    const deps = makeDeps();
    createSessionHeaderRunner(deps)("rename");
    expect(deps.openRename).toHaveBeenCalledTimes(1);
    expect(deps.openFiles).not.toHaveBeenCalled();
    expect(deps.openDiff).not.toHaveBeenCalled();
    expect(deps.openExplorer).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it("routes 查看项目文件/停止 to their own callbacks", () => {
    const deps = makeDeps();
    const run = createSessionHeaderRunner(deps);
    run("files");
    run("stop");
    expect(deps.openFiles).toHaveBeenCalledTimes(1);
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(deps.openRename).not.toHaveBeenCalled();
  });

  it("routes 查看 diff/查看文件 to the injected official-opener wrappers, each once", () => {
    const deps = makeDeps();
    const run = createSessionHeaderRunner(deps);
    run("diff");
    run("explorer");
    expect(deps.openDiff).toHaveBeenCalledTimes(1);
    expect(deps.openExplorer).toHaveBeenCalledTimes(1);
    expect(deps.openFiles).not.toHaveBeenCalled();
    expect(deps.openRename).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
  });
});
