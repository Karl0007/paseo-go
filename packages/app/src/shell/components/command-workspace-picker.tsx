// 快捷指令的项目选择 sheet (card C7): the workspaceId-缺省 path from the ruling —
// 限该 host 的 workspace 列表, presented by the official menu engine in its sheet
// shape (same BottomSheetModal the row menus ride), driven programmatically: the
// runner owns `open`, an answer runs the command, dismissal cancels.
import { useCallback, type ReactElement } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { FolderTree } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

const ThemedFolder = withUnistyles(FolderTree, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

// Icon through a helper so no JSX crosses a prop boundary per render (file-action-menu).
function folderLeading(): ReactElement {
  return <ThemedFolder size={16} />;
}

export interface CommandWorkspaceOption {
  workspaceId: string;
  name: string;
  projectName: string;
}

// Stable-handler row (chat-row-menu pattern): the engine takes selection through
// `selectItem`, so the sheet's rows must not rebuild closures per parent render.
function WorkspacePickRow({
  option,
  choose,
}: {
  option: CommandWorkspaceOption;
  choose: (workspaceId: string) => void;
}): ReactElement {
  const onSelect = useCallback(() => choose(option.workspaceId), [choose, option.workspaceId]);
  return (
    <DropdownMenuItem
      leading={folderLeading()}
      description={option.projectName}
      onSelect={onSelect}
      testID={`shell-command-pick-${option.workspaceId}`}
    >
      {option.name}
    </DropdownMenuItem>
  );
}

export function CommandWorkspacePickerSheet({
  open,
  options,
  onSelect,
  onClose,
}: {
  open: boolean;
  options: readonly CommandWorkspaceOption[];
  onSelect: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={handleOpenChange}>
      {/* The sheet is opened by the runner, never by pressing this anchor. */}
      <DropdownMenuTrigger
        testID="shell-command-picker-trigger"
        accessibilityRole="button"
        style={styles.hiddenTrigger}
      >
        {null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sheetTitle={t("commands.pickWorkspace")}
        width={280}
        testID="shell-command-picker"
      >
        {options.length === 0 ? (
          <DropdownMenuItem disabled muted>
            {t("commands.errors.hostNoWorkspaces")}
          </DropdownMenuItem>
        ) : (
          options.map((option) => (
            <WorkspacePickRow key={option.workspaceId} option={option} choose={onSelect} />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create(() => ({
  hiddenTrigger: {
    width: 0,
    height: 0,
    overflow: "hidden",
  },
}));
