// Long-press row menu (DESIGN §4, card C3): the official menu engine in its
// ContextMenu shape (sheet on compact native, docs/menus.md), rendered per chat row.
// The visible plan comes from `chatMenuPlan` — the same pure matrix the report
// quotes — so label, order and enablement live in exactly one place. 重命名 is a
// menu *page* (MenuTextField + commit row), pushed in place on the sheet, never a
// second dialog system.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, PenLine, Pin, PinOff, Square, Trash2 } from "lucide-react-native";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  MenuTextField,
  useMenuContext,
} from "@/components/ui/menu";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import {
  chatMenuPlan,
  type ChatMenuActionId,
  type ShellAgentActions,
  type ShellChatTarget,
} from "@/shell/shellAgentActions";

/** The rename page's id, shared between the `MenuSubTrigger` row and the page entry. */
const RENAME_PAGE_ID = "chatRename";

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
const ThemedTrash2 = withUnistyles(Trash2, (theme) => ({ color: theme.colors.destructive }));

export interface ChatRowMenuState {
  pinned: boolean;
  archived: boolean;
  stoppable: boolean;
  /** The live shell alias, when one is set — seeds the rename field. */
  alias: string | undefined;
}

const MENU_LABEL_KEY: Record<ChatMenuActionId, string> = {
  pin: "chats.menu.pin",
  unpin: "chats.menu.unpin",
  rename: "chats.menu.rename",
  archive: "chats.menu.archive",
  unarchive: "chats.menu.unarchive",
  stop: "chats.menu.stop",
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
    case "delete":
      return <ThemedTrash2 size={16} />;
  }
}

// Shared with the C14 session-header menu: same target, same alias semantics.
export function ChatRenamePage({
  target,
  alias,
  actions,
}: {
  target: ShellChatTarget;
  alias: string | undefined;
  actions: ShellAgentActions;
}): ReactElement {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const menu = useMenuContext("ChatRenamePage");
  const [value, setValue] = useState(alias ?? "");
  const save = useCallback(() => {
    // `rename` treats blank as “clear the alias”, so the save row doubles as the
    // reset path; the explicit row below only appears when an alias exists.
    actions.rename(target, value);
    menu.setOpen(false);
  }, [actions, menu, target, value]);
  const reset = useCallback(() => {
    actions.clearAlias(target);
    menu.setOpen(false);
  }, [actions, menu, target]);
  return (
    <>
      <MenuTextField
        initialValue={alias ?? ""}
        onChangeText={setValue}
        placeholder={t("chats.menu.renamePlaceholder")}
        accessibilityLabel={t("chats.menu.renameTitle")}
        autoFocus
        onSubmitEditing={save}
        testID={`shell-rename-field-${target.key}`}
      />
      {alias !== undefined ? (
        <>
          <MenuSeparator />
          <MenuItem onSelect={reset} testID={`shell-rename-reset-${target.key}`}>
            {t("chats.menu.renameClear")}
          </MenuItem>
        </>
      ) : null}
      <MenuSeparator />
      <MenuItem closeOnSelect={false} onSelect={save} testID={`shell-rename-save-${target.key}`}>
        {t("chats.menu.renameSave")}
      </MenuItem>
    </>
  );
}

// A row of its own so its onSelect handler is a stable reference: the engine takes
// selection through `selectItem`, and an inline arrow per render would rebuild the
// whole sheet's row closures on every parent update.
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
}: {
  target: ShellChatTarget;
  state: ChatRowMenuState;
  actions: ShellAgentActions;
  displayTitle: string;
}): ReactElement {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const plan = chatMenuPlan(state);
  const pages = useMemo(
    () => [
      {
        id: RENAME_PAGE_ID,
        title: t("chats.menu.renameTitle"),
        // A page you type into is not one the pointer opens or dismisses on its own.
        hoverIntent: false,
        content: <ChatRenamePage target={target} alias={state.alias} actions={actions} />,
      },
    ],
    [actions, state.alias, t, target],
  );

  const run = useCallback(
    (id: ChatMenuActionId) => {
      switch (id) {
        case "pin":
          actions.pin(target);
          break;
        case "unpin":
          actions.unpin(target);
          break;
        case "archive":
          actions.archive(target);
          break;
        case "unarchive":
          actions.unarchive(target);
          break;
        case "stop":
          void actions.stop(target);
          break;
        case "delete":
          void actions.remove(target, displayTitle);
          break;
        case "rename":
          break;
      }
    },
    [actions, displayTitle, target],
  );

  return (
    <ContextMenuContent
      sheetTitle={displayTitle}
      pages={pages}
      width={280}
      testID={`shell-chat-menu-${target.key}`}
    >
      {plan.flatMap((item) => {
        const label = t(MENU_LABEL_KEY[item.id]);
        const row =
          item.id === "rename" ? (
            <MenuSubTrigger
              key={item.id}
              id={RENAME_PAGE_ID}
              leading={menuLeading(item.id)}
              testID={`shell-menu-rename-${target.key}`}
            >
              {label}
            </MenuSubTrigger>
          ) : (
            <MenuActionRow
              key={item.id}
              id={item.id}
              label={label}
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
