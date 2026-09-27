// Long-press row menu (DESIGN §4, card C3; C33 per DESIGN §14.3): the official menu
// engine in its ContextMenu shape — the anchored popover on compact native
// (docs/menus.md), rendered per chat row. The visible plan comes from `chatMenuPlan`
// — the same pure matrix the report quotes — so label, order and enablement live in
// exactly one place. 重命名 is no longer a menu page (C33 moved the C19 MenuTextField
// sub-page out to the (shell)/rename screen): the row closes the menu through the
// engine's own select path and hands the target to the injected `openRename`
// callback, so this module never navigates itself and the dispatch stays a pure,
// unit-tested table (`createChatMenuRunner`).
import { useCallback, useMemo, type ReactElement } from "react";
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
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
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

export function ChatRowMenuContent({
  target,
  state,
  actions,
  displayTitle,
  openRename,
}: {
  target: ShellChatTarget;
  state: ChatRowMenuState;
  actions: ShellAgentActions;
  displayTitle: string;
  openRename: (target: ShellChatTarget) => void;
}): ReactElement {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const plan = chatMenuPlan(state);
  const run = useMemo(
    () => createChatMenuRunner({ actions, target, displayTitle, openRename }),
    [actions, displayTitle, openRename, target],
  );

  return (
    <ContextMenuContent width={280} testID={`shell-chat-menu-${target.key}`}>
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
    </ContextMenuContent>
  );
}
