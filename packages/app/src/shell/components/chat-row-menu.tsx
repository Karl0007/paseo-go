// Long-press row menu (DESIGN §4, card C3; C33 per DESIGN §14.3): the official menu
// engine's item vocabulary + anchored surface, hosted by the SHELL (KI-11 ruling ①).
// The visible plan comes from `chatMenuPlan` — the same pure matrix the report quotes
// — so label, order and enablement live in exactly one place. 重命名 is no longer a
// menu page (C33 moved the C19 MenuTextField sub-page out to the (shell)/rename
// screen): the row closes the menu through the engine's own select path and hands the
// target to the injected `openRename` callback, so this module never navigates itself
// and the dispatch stays a pure, unit-tested table (`createChatMenuRunner`).
//
// Why a shell host instead of the per-row engine surface (KI-11): the engine's
// MenuOverlay is a window-level native Modal, and SHOWING a Modal mid-gesture cancels
// the row's touch stream (C20 device finding, re-verified for the popover form in
// C33 — BUILD.md §"菜单转 popover 后…抬手才 materialize"). Ruling ① wants the menu at
// the 500ms threshold WITH the finger still down, and ruling ② wants the same finger
// to then slide into a row drag — both need the stream to survive, so the mid-hold
// surface cannot be a Modal. The host below renders the engine's OWN `AnchoredSurface`
// + `MenuPage` + `MenuItem` (zero engine-file changes, pixel-identical popover) inside
// the app window, mounted once at the shell root.
import { useCallback, useMemo, useEffect, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  PenLine,
  Pin,
  PinOff,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react-native";
import { BackHandler, Platform, View, type ViewStyle } from "react-native";
import { create } from "zustand";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { Rect } from "@/components/ui/menu";
import { MenuContextProvider, useMenuState } from "@/components/ui/menu/menu-context";
import { AnchoredSurface } from "@/components/ui/menu/menu-overlay";
import { MenuPage } from "@/components/ui/menu/menu-item";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  chatMenuPlan,
  type ChatMenuActionId,
  type ShellAgentActions,
  type ShellChatTarget,
} from "@/shell/shellAgentActions";

// Menu icons ride the engine's own muted rail; the delete icon takes the destructive
// red the token band reserves for it.
const ThemedPin = withUnistyles(Pin, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPinOff = withUnistyles(PinOff, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPenLine = withUnistyles(PenLine, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedArchive = withUnistyles(Archive, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedArchiveRestore = withUnistyles(ArchiveRestore, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedSquare = withUnistyles(Square, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedRefreshCw = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTrash2 = withUnistyles(Trash2, (theme) => ({ color: theme.colors.destructive }));

export interface ChatRowMenuState {
  pinned: boolean;
  archived: boolean;
  stoppable: boolean;
  /** C24: imported row → the plan carries 刷新. */
  imported: boolean;
}

const MENU_LABEL_KEY: Record<ChatMenuActionId, string> = {
  pin: "chats.menu.pin",
  unpin: "chats.menu.unpin",
  rename: "chats.menu.rename",
  archive: "chats.menu.archive",
  unarchive: "chats.menu.unarchive",
  stop: "chats.menu.stop",
  refresh: "chats.menu.refresh",
  delete: "chats.menu.delete",
};

function menuLeading(id: ChatMenuActionId): ReactElement {
  switch (id) {
    case "pin":
      return <ThemedPin size={16} />;
    case "unpin":
      return <ThemedPinOff size={16} />;
    case "rename":
      return <ThemedPenLine size={16} />;
    case "archive":
      return <ThemedArchive size={16} />;
    case "unarchive":
      return <ThemedArchiveRestore size={16} />;
    case "stop":
      return <ThemedSquare size={16} />;
    case "refresh":
      return <ThemedRefreshCw size={16} />;
    case "delete":
      return <ThemedTrash2 size={16} />;
  }
}

export interface ChatMenuRunnerDeps {
  actions: ShellAgentActions;
  target: ShellChatTarget;
  displayTitle: string;
  /** C33: 重命名 leaves the menu — the screen opener pushes (shell)/rename. */
  openRename: (target: ShellChatTarget) => void;
}

/**
 * The dispatch table, React-free: every menu row's onSelect funnels its action id
 * through here. 重命名 is the one row the menu does not act on itself — it hands the
 * target to the injected screen opener, never to `actions` directly (the rename
 * screen owns the form and the save). Exported so the matrix test pins the routing
 * without mounting a navigator.
 */
export function createChatMenuRunner(deps: ChatMenuRunnerDeps): (id: ChatMenuActionId) => void {
  return (id) => {
    switch (id) {
      case "pin":
        deps.actions.pin(deps.target);
        break;
      case "unpin":
        deps.actions.unpin(deps.target);
        break;
      case "archive":
        deps.actions.archive(deps.target);
        break;
      case "unarchive":
        deps.actions.unarchive(deps.target);
        break;
      case "stop":
        void deps.actions.stop(deps.target);
        break;
      case "refresh":
        void deps.actions.refresh(deps.target);
        break;
      case "delete":
        void deps.actions.remove(deps.target, deps.displayTitle);
        break;
      case "rename":
        deps.openRename(deps.target);
        break;
    }
  };
}

// A row of its own so its onSelect handler is a stable reference: the engine takes
// selection through `selectItem`, and an inline arrow per render would rebuild the
// whole menu's row closures on every parent update.
function MenuActionRow({
  id,
  label,
  enabled,
  run,
  testID,
}: {
  id: ChatMenuActionId;
  label: string;
  enabled: boolean;
  run: (id: ChatMenuActionId) => void;
  testID: string;
}): ReactElement {
  const onSelect = useCallback(() => run(id), [run, id]);
  return (
    <ContextMenuItem
      leading={menuLeading(id)}
      disabled={!enabled}
      destructive={id === "delete"}
      onSelect={onSelect}
      testID={testID}
    >
      {label}
    </ContextMenuItem>
  );
}

export interface ChatRowMenuItemsProps {
  target: ShellChatTarget;
  state: ChatRowMenuState;
  actions: ShellAgentActions;
  displayTitle: string;
  openRename: (target: ShellChatTarget) => void;
}

/**
 * The engine-form surface: `ContextMenuContent` (Modal popover) around the plan
 * rows. The 对话 rows no longer use it (KI-11: their mid-hold menu is the
 * window-hosted `ShellRowMenuHost` below); the 工作区 session rows — outside
 * KI-11's timing rulings — still open their menu through it.
 */
export function ChatRowMenuContent(props: ChatRowMenuItemsProps): ReactElement {
  return (
    <ContextMenuContent width={280} testID={`shell-chat-menu-${props.target.key}`}>
      <ChatRowMenuItems {...props} />
    </ContextMenuContent>
  );
}

/**
 * The plan's rows, rendered under whatever `MenuContext` the caller provides —
 * the shell host below supplies one, so the engine's item vocabulary (row
 * geometry, select path, destructive styling) is reused verbatim while the
 * SURFACE lives in the app window instead of the engine's Modal.
 */
export function ChatRowMenuItems({
  target,
  state,
  actions,
  displayTitle,
  openRename,
}: ChatRowMenuItemsProps): ReactElement {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const plan = chatMenuPlan(state);
  const run = useMemo(
    () => createChatMenuRunner({ actions, target, displayTitle, openRename }),
    [actions, displayTitle, openRename, target],
  );

  return (
    <>
      {plan.flatMap((item) => {
        const row = (
          <MenuActionRow
            key={item.id}
            id={item.id}
            label={t(MENU_LABEL_KEY[item.id])}
            enabled={item.enabled}
            run={run}
            testID={`shell-menu-${item.id}-${target.key}`}
          />
        );
        // 删除 is the one row that cannot be undone; it sits under a rule.
        return item.id === "delete" ? [<ContextMenuSeparator key="sep-delete" />, row] : [row];
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// The shell-hosted single-instance row menu (KI-11 ruling ①/② — see the header
// for why the mid-hold surface cannot be the engine's Modal). One request is
// live at a time; the backdrop owns the outside-tap, the hardware back owns
// Android, and `closeFor` lets a row unmount mid-menu retire ITS OWN request
// without stealing a newer row's.
// ---------------------------------------------------------------------------

export interface ShellRowMenuRequest {
  target: ShellChatTarget;
  state: ChatRowMenuState;
  actions: ShellAgentActions;
  displayTitle: string;
  openRename: (target: ShellChatTarget) => void;
  /**
   * App-window coordinates — the responder-space touch point of the long press
   * (KI-11: no status-bar shift; the surface lives in the same window as the
   * list, not in a translucent Modal above it) or the measured rect of the ⋯
   * button (measureInWindow already reads in this space).
   */
  anchor: Rect;
}

interface ShellRowMenuStore {
  request: ShellRowMenuRequest | null;
  open: (request: ShellRowMenuRequest) => void;
  closeFor: (key: string) => void;
  close: () => void;
}

export const useShellRowMenuStore = create<ShellRowMenuStore>((set, get) => ({
  request: null,
  open: (request) => set({ request }),
  closeFor: (key) => {
    if (get().request?.target.key === key) set({ request: null });
  },
  close: () => set({ request: null }),
}));

// Above every in-window layer the shell owns (headers, tab bar, rail) — the
// coverage the engine's window-level Modal used to give the row menu.
const HOST_STYLE: ViewStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1000,
};

/**
 * Mount ONCE at the shell root (split-host). Renders nothing while idle; when
 * a request is live it shows the engine's own anchored popover surface at the
 * request's anchor.
 */
export function ShellRowMenuHost(): ReactElement | null {
  const request = useShellRowMenuStore((state) => state.request);
  const close = useShellRowMenuStore((state) => state.close);
  // The engine's state hook keeps the select semantics exact (close-then-act,
  // iOS teardown grace); the surface's close paths all land back on the store.
  const menu = useMenuState({
    open: request !== null,
    onOpenChange: (next) => {
      if (!next) close();
    },
    compactMode: "popover",
  });

  const closeSurface = useCallback(() => {
    menu.setOpen(false);
  }, [menu]);

  // The Modal's onRequestClose equivalent.
  useEffect(() => {
    if (Platform.OS !== "android" || request === null) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeSurface();
      return true;
    });
    return () => subscription.remove();
  }, [request, closeSurface]);

  if (request === null) return null;
  return (
    <View testID="shell-row-menu-host" accessibilityViewIsModal style={HOST_STYLE}>
      <MenuContextProvider value={menu}>
        <AnchoredSurface
          open
          onClose={closeSurface}
          anchorRect={request.anchor}
          anchorRef={menu.triggerRef}
          width={280}
          testID={`shell-chat-menu-${request.target.key}`}
        >
          <MenuPage depth={0}>
            <ChatRowMenuItems
              target={request.target}
              state={request.state}
              actions={request.actions}
              displayTitle={request.displayTitle}
              openRename={request.openRename}
            />
          </MenuPage>
        </AnchoredSurface>
      </MenuContextProvider>
    </View>
  );
}
