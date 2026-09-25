// 工作区 tab 收藏夹快捷指令行 (card C7, DESIGN §5): the ⚡ twin of the favorites
// file row — same rail, same long-press ContextMenu engine. 副标题 `host›项目 ·
// 模型或默认`; tap runs the command (spinner replaces the bolt while the create is
// in flight, re-entry guarded by the runner); long-press offers 立即运行｜编辑｜
// 删除(确认). Offline hosts render dimmed, and the run itself reports 离线 through
// the action layer — never a silent no-op.
import { useCallback, type ReactElement } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { PenLine, Play, Trash2, Zap } from "lucide-react-native";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSessionStore } from "@/stores/session-store";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import type { ShellCommand } from "@/shell/stores/commands";

// Menu icons ride the engine's muted rail; built through a helper so no JSX crosses
// a prop boundary per render (file-action-menu pattern).
const ThemedPlay = withUnistyles(Play, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedPenLine = withUnistyles(PenLine, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedTrash2 = withUnistyles(Trash2, (theme) => ({ color: theme.colors.destructive }));

type CommandMenuId = "run" | "edit" | "delete";

function menuLeading(id: CommandMenuId): ReactElement {
  switch (id) {
    case "run":
      return <ThemedPlay size={16} />;
    case "edit":
      return <ThemedPenLine size={16} />;
    case "delete":
      return <ThemedTrash2 size={16} />;
  }
}

// A row of its own so its onSelect handler is a stable reference: the engine takes
// selection through `selectItem`, and an inline arrow per render would rebuild the
// sheet's row closures on every parent update (chat-row-menu pattern).
function CommandMenuRow({
  id,
  label,
  run,
  testID,
}: {
  id: CommandMenuId;
  label: string;
  run: (id: CommandMenuId) => void;
  testID: string;
}): ReactElement {
  const onSelect = useCallback(() => run(id), [run, id]);
  return (
    <ContextMenuItem
      leading={menuLeading(id)}
      destructive={id === "delete"}
      onSelect={onSelect}
      testID={testID}
    >
      {label}
    </ContextMenuItem>
  );
}

export function WorkspaceCommandRow({
  command,
  hostLabel,
  dimmed,
  running,
  onRun,
  onEdit,
  onRemove,
}: {
  command: ShellCommand;
  hostLabel: string;
  dimmed: boolean;
  running: boolean;
  onRun: (command: ShellCommand) => void;
  onEdit: (command: ShellCommand) => void;
  onRemove: (command: ShellCommand) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const workspace = useSessionStore((state) =>
    command.workspaceId
      ? state.sessions[command.hostId]?.workspaces.get(command.workspaceId)
      : undefined,
  );
  const projectLabel = command.workspaceId
    ? workspace?.projectCustomName?.trim() ||
      workspace?.projectDisplayName ||
      workspace?.title?.trim() ||
      workspace?.name ||
      command.workspaceId
    : t("commands.askEveryTime");
  const subtitle = `${hostLabel} › ${projectLabel} · ${command.providerModel ?? t("commands.defaultModel")}`;

  const handlePress = useCallback(() => onRun(command), [onRun, command]);
  const runMenuAction = useCallback(
    (id: CommandMenuId) => {
      if (id === "run") onRun(command);
      else if (id === "edit") onEdit(command);
      else void onRemove(command);
    },
    [onRun, onEdit, onRemove, command],
  );
  // C12: 长弹触觉（官方引擎不自发）+ 行级无障碍标签（标题+状态）。
  const handleLongPress = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
  }, []);
  const rowLabel = dimmed
    ? `${command.name} · ${subtitle} · ${t("chats.hostStatus.offline")}`
    : `${command.name} · ${subtitle}`;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        onPress={handlePress}
        onLongPress={handleLongPress}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        testID={`shell-command-row-${command.id}`}
      >
        <View style={styles.row}>
          {running ? (
            <ActivityIndicator size="small" color={styles.boltColor.color} />
          ) : (
            <Zap size={16} color={styles.boltColor.color} fill={styles.boltColor.color} />
          )}
          <View style={styles.rowText}>
            <Text
              style={[styles.name, dimmed && styles.nameDimmed]}
              numberOfLines={1}
              testID={`shell-command-name-${command.id}`}
            >
              {command.name}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
      </ContextMenuTrigger>
      <ContextMenuContent sheetTitle={command.name} width={280}>
        <CommandMenuRow
          id="run"
          label={t("commands.menu.run")}
          run={runMenuAction}
          testID={`shell-command-menu-run-${command.id}`}
        />
        <CommandMenuRow
          id="edit"
          label={t("commands.menu.edit")}
          run={runMenuAction}
          testID={`shell-command-menu-edit-${command.id}`}
        />
        <ContextMenuSeparator />
        <CommandMenuRow
          id="delete"
          label={t("commands.menu.delete")}
          run={runMenuAction}
          testID={`shell-command-menu-delete-${command.id}`}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  boltColor: {
    color: theme.colors.accent,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  nameDimmed: {
    color: theme.colors.foregroundMuted,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
