/**
 * @vitest-environment jsdom
 */
// KI-11 acceptance: the window-hosted row menu surface. The engine's item
// vocabulary renders through the shell store (no Modal, so the row's touch
// stream survives the mid-hold open); a plan row's press funnels through the
// engine's own select path into the injected actions and retires the request;
// the backdrop dismisses without acting; `closeFor` is key-guarded so a row
// unmounting never steals another row's menu.
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellAgentActions, ShellChatTarget } from "@/shell/shellAgentActions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // @/i18n/i18next wires the real instance through this plugin at import time.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo" }));

import {
  ShellRowMenuHost,
  useShellRowMenuStore,
  type ShellRowMenuRequest,
} from "@/shell/components/chat-row-menu";

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

function makeRequest(actions: ShellAgentActions): ShellRowMenuRequest {
  return {
    target,
    state: { pinned: false, archived: false, stoppable: false, imported: false },
    actions,
    displayTitle: "标题",
    openRename: vi.fn(),
    anchor: { x: 120, y: 340, width: 0, height: 0 },
  };
}

function open(request: ShellRowMenuRequest): void {
  act(() => {
    useShellRowMenuStore.getState().open(request);
  });
}

beforeEach(() => {
  // The vitest JSX transform reads React from the global (menu-root.test idiom).
  vi.stubGlobal("React", React);
  useShellRowMenuStore.setState({ request: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useShellRowMenuStore.setState({ request: null });
});

describe("ShellRowMenuHost", () => {
  it("renders nothing while idle and the anchored plan when a request is live", () => {
    const { container } = render(<ShellRowMenuHost />);
    expect(container.firstChild).toBeNull();

    open(makeRequest(makeActions()));
    expect(screen.getByTestId("shell-chat-menu-s1:a1")).toBeTruthy();
    // The plan for an unpinned live row: pin first, no unpin row.
    expect(screen.getByTestId("shell-menu-pin-s1:a1")).toBeTruthy();
    expect(screen.queryByTestId("shell-menu-unpin-s1:a1")).toBeNull();
  });

  it("a row press runs the injected action through the engine select path and retires the request", () => {
    const actions = makeActions();
    render(<ShellRowMenuHost />);
    open(makeRequest(actions));

    fireEvent.click(screen.getByTestId("shell-menu-pin-s1:a1"));

    expect(actions.pin).toHaveBeenCalledWith(target);
    expect(useShellRowMenuStore.getState().request).toBeNull();
    expect(screen.queryByTestId("shell-chat-menu-s1:a1")).toBeNull();
  });

  it("the backdrop dismisses without acting", () => {
    const actions = makeActions();
    render(<ShellRowMenuHost />);
    open(makeRequest(actions));

    fireEvent.click(screen.getByTestId("shell-chat-menu-s1:a1-backdrop"));

    expect(actions.pin).not.toHaveBeenCalled();
    expect(useShellRowMenuStore.getState().request).toBeNull();
  });

  it("closeFor is key-guarded: another row's unmount never steals the live menu", () => {
    render(<ShellRowMenuHost />);
    open(makeRequest(makeActions()));

    act(() => {
      useShellRowMenuStore.getState().closeFor("s1:other");
    });
    expect(useShellRowMenuStore.getState().request).not.toBeNull();

    act(() => {
      useShellRowMenuStore.getState().closeFor(target.key);
    });
    expect(useShellRowMenuStore.getState().request).toBeNull();
  });

  it("a newer request replaces the live one (single instance, latest wins)", () => {
    render(<ShellRowMenuHost />);
    open(makeRequest(makeActions()));
    const second: ShellRowMenuRequest = {
      ...makeRequest(makeActions()),
      target: { key: "s1:a2", serverId: "s1", agentId: "a2" },
    };
    open(second);

    expect(screen.getByTestId("shell-chat-menu-s1:a2")).toBeTruthy();
    expect(screen.queryByTestId("shell-chat-menu-s1:a1")).toBeNull();
  });
});
