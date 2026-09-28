/**
 * @vitest-environment jsdom
 */
// KI-5 acceptance: the host chip's sheet contract. The engine itself is tested by
// the menu suite; here the rows are the product — order is local-first (official
// orderHostsLocalFirst), the current host carries `selected`, and the「添加主机」
// row is present even in the single-host state (the card's whole point: that row
// used to be unreachable). Rows surface through a mocked dropdown-menu the way
// chat-row-menu.test.ts mocks the engine — no menu stack mounted.
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";

const localServerId = vi.hoisted(() => ({ current: null as string | null }));
const menuState = vi.hoisted(() => ({ onOpenChange: null as ((open: boolean) => void) | null }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/shell/i18n", () => ({ SHELL_I18N_NAMESPACE: "paseoGo" }));

vi.mock("@/hooks/use-is-local-daemon", () => ({
  useLocalDaemonServerId: () => localServerId.current,
}));

// The status dot rides the host runtime store; the sheet only needs its identity.
vi.mock("@/components/hosts/host-picker", () => ({
  HostStatusDotSlot: ({ serverId }: { serverId: string }) =>
    React.createElement("span", { "data-testid": `dot-${serverId}` }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: React.ReactNode;
  }) => {
    menuState.onOpenChange = onOpenChange ?? null;
    return React.createElement("div", { "data-open": String(Boolean(open)) }, children);
  },
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: ({
    sheetTitle,
    children,
  }: {
    sheetTitle?: string;
    children?: React.ReactNode;
  }) => React.createElement("div", { "data-testid": "sheet", "data-title": sheetTitle }, children),
  DropdownMenuItem: ({
    children,
    description,
    selected,
    onSelect,
    testID,
  }: {
    children?: React.ReactNode;
    description?: string;
    selected?: boolean;
    onSelect?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        "data-testid": testID,
        type: "button",
        "data-selected": String(Boolean(selected)),
        "data-description": description,
        onClick: onSelect,
      },
      children,
    ),
}));

import { ShellHostPickerSheet } from "@/shell/components/host-picker-sheet";

function makeHost(serverId: string, label = serverId): HostProfile {
  return {
    serverId,
    label,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
}

function renderedRowIds(): string[] {
  return screen
    .getAllByRole("button")
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) => id.startsWith("shell-host-pick-"));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  localServerId.current = null;
  menuState.onOpenChange = null;
});

afterEach(cleanup);

describe("ShellHostPickerSheet", () => {
  it("orders rows local-first and always ends with the add-host row", () => {
    localServerId.current = "srv_local";
    render(
      <ShellHostPickerSheet
        open
        hosts={[makeHost("srv_remote"), makeHost("srv_local")]}
        currentServerId={null}
        onPick={vi.fn()}
        onAddHost={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(renderedRowIds()).toEqual([
      "shell-host-pick-srv_local",
      "shell-host-pick-srv_remote",
      "shell-host-pick-add",
    ]);
    expect(screen.getByTestId("sheet").dataset.title).toBe("import.chooseHost");
    expect(screen.getByTestId("shell-host-pick-add").textContent).toBe("import.addHost");
  });

  it("marks only the current host selected", () => {
    render(
      <ShellHostPickerSheet
        open
        hosts={[makeHost("srv_a", "LAPTOP-A"), makeHost("srv_b", "LAPTOP-B")]}
        currentServerId="srv_b"
        onPick={vi.fn()}
        onAddHost={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("shell-host-pick-srv_a").dataset.selected).toBe("false");
    expect(screen.getByTestId("shell-host-pick-srv_b").dataset.selected).toBe("true");
    // description carries the serverId (official chooser row parity)
    expect(screen.getByTestId("shell-host-pick-srv_b").dataset.description).toBe("srv_b");
  });

  it("single-host state still offers the add-host row (KI-5 缺口本体)", () => {
    render(
      <ShellHostPickerSheet
        open
        hosts={[makeHost("srv_only")]}
        currentServerId="srv_only"
        onPick={vi.fn()}
        onAddHost={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(renderedRowIds()).toEqual(["shell-host-pick-srv_only", "shell-host-pick-add"]);
  });

  it("picking a row reports its serverId; the add row reports add-host", () => {
    const onPick = vi.fn();
    const onAddHost = vi.fn();
    render(
      <ShellHostPickerSheet
        open
        hosts={[makeHost("srv_a"), makeHost("srv_b")]}
        currentServerId="srv_a"
        onPick={onPick}
        onAddHost={onAddHost}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("shell-host-pick-srv_b"));
    expect(onPick).toHaveBeenCalledWith("srv_b");
    fireEvent.click(screen.getByTestId("shell-host-pick-add"));
    expect(onAddHost).toHaveBeenCalledTimes(1);
  });

  it("dismissal (open -> false) routes to onClose; re-open does not", () => {
    const onClose = vi.fn();
    render(
      <ShellHostPickerSheet
        open
        hosts={[makeHost("srv_a")]}
        currentServerId="srv_a"
        onPick={vi.fn()}
        onAddHost={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(menuState.onOpenChange).toBeTypeOf("function");
    menuState.onOpenChange?.(true);
    expect(onClose).not.toHaveBeenCalled();
    menuState.onOpenChange?.(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
