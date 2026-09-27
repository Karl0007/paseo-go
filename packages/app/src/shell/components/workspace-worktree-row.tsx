// L2 worktree 行 (DESIGN §14.8, card C26): worktree 名 (代表记录 title‖name) +
// 路径尾段/分支副行 + 展开 chevron + 合并活跃角标. 行体 = 该 worktree 的文件页
// (代表记录 id); chevron 钮 = 展开/收起 L3; 长按 = 菜单「复制 worktree 路径 +
// 归档工作区」——可见项/禁用条件来自纯矩阵 `worktreeMenuPlan`（R2-22，对齐
// chatMenuPlan 姿势）;归档走官方 archiveWorkspace RPC (经 workspace-archive
// 的乐观隐藏)，对合并前全部记录一次执行. 菜单复用官方 ContextMenu popover
// 引擎 (C33 形态).
import { useCallback, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Archive, Check, ChevronDown, ChevronRight, GitBranch } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { worktreeMenuPlan } from "@/shell/workspace/worktree-menu";
import { WorkspaceTreeBadge } from "@/shell/components/workspace-project-row";
import { pathTail, type ShellWorktreeRow, type WorkspaceTreeAgent } from "@/shell/workspace/derive";

// C12 无障碍/触觉: chevron 钮 44dp 目标 + 长按/复制的轻触觉（官方 sidebar idiom，
// fire-and-forget）。
const CHEVRON_HIT_SLOP = { top: 12, bottom: 12, left: 10, right: 10 } as const;
const ThemedArchive = withUnistyles(Archive, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedCheck = withUnistyles(Check, (theme) => ({ color: theme.colors.foregroundMuted }));

// Menu icons ride the engine's muted rail (the chat menu's leading idiom: a function,
// so the JSX is not an inline per-render prop).
function copyLeading(): ReactElement {
  return <ThemedCheck size={16} />;
}
function archiveLeading(): ReactElement {
  return <ThemedArchive size={16} />;
}

function selectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

export function WorkspaceWorktreeRow<A extends WorkspaceTreeAgent>({
  row,
  expanded,
  dimmed,
  onToggle,
  onOpenFiles,
  onArchive,
}: {
  row: ShellWorktreeRow<A>;
  expanded: boolean;
  /** Offline-host sections grey their cached rows (menu actions stay inert). */
  dimmed: boolean;
  onToggle: (row: ShellWorktreeRow<A>) => void;
  onOpenFiles: (row: ShellWorktreeRow<A>) => void;
  onArchive: (row: ShellWorktreeRow<A>) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const toast = useToast();

  const handleToggle = useCallback(() => onToggle(row), [onToggle, row]);
  const handleOpen = useCallback(() => onOpenFiles(row), [onOpenFiles, row]);
  const handleCopyPath = useCallback(() => {
    void (async () => {
      try {
        await Clipboard.setStringAsync(row.cwd);
        selectionHaptic();
        toast.show(t("workspace.toast.pathCopied"));
      } catch {
        toast.error(t("workspace.toast.copyFailed"));
      }
    })();
  }, [row.cwd, toast, t]);
  const handleArchive = useCallback(() => onArchive(row), [onArchive, row]);

  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.body, pressed && styles.rowPressed],
    [],
  );
  const tail = pathTail(row.cwd);
  const subtitle = [tail.length > 0 ? tail : null, row.branch].filter(Boolean).join(" · ");
  const labelParts = [row.name, subtitle.length > 0 ? subtitle : null];
  if (row.activeCount > 0)
    labelParts.push(t("workspace.a11yActiveAgents", { count: row.activeCount }));
  if (dimmed) labelParts.push(t("chats.hostStatus.offline"));

  return (
    <ContextMenu compactMode="popover">
      <View
        style={[styles.shell, dimmed && styles.shellDimmed]}
        testID={`shell-workspace-worktree-shell-${row.key}`}
      >
        <Pressable
          onPress={handleToggle}
          accessibilityRole="button"
          accessibilityLabel={t(expanded ? "workspace.a11yExpanded" : "workspace.a11yCollapsed")}
          hitSlop={CHEVRON_HIT_SLOP}
          testID={`shell-workspace-worktree-toggle-${row.key}`}
          style={styles.chevronSlot}
        >
          {expanded ? (
            <ChevronDown size={15} color={styles.chevron.color} />
          ) : (
            <ChevronRight size={15} color={styles.chevron.color} />
          )}
        </Pressable>
        <ContextMenuTrigger
          testID={`shell-workspace-worktree-${row.key}`}
          accessibilityRole="button"
          accessibilityLabel={labelParts.filter(Boolean).join(" · ")}
          onPress={handleOpen}
          onLongPress={selectionHaptic}
          style={triggerStyle}
        >
          <View style={styles.iconWrap}>
            <GitBranch size={16} color={styles.icon.color} />
          </View>
          <View style={styles.textWrap}>
            <View style={styles.titleLine}>
              <Text style={styles.title} numberOfLines={1}>
                {row.name}
              </Text>
            </View>
            {subtitle.length > 0 ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <WorkspaceTreeBadge
            activeCount={row.activeCount}
            needsInputCount={row.needsInputCount}
            testID={`shell-workspace-worktree-badge-${row.key}`}
          />
        </ContextMenuTrigger>
      </View>
      <ContextMenuContent width={280} testID={`shell-workspace-worktree-menu-${row.key}`}>
        {worktreeMenuPlan({ cwd: row.cwd }).map((item) =>
          item.id === "copyPath" ? (
            <ContextMenuItem
              key={item.id}
              leading={copyLeading()}
              disabled={!item.enabled}
              onSelect={handleCopyPath}
              testID={`shell-worktree-copy-${row.key}`}
            >
              {t("workspace.menu.copyPath")}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              key={item.id}
              leading={archiveLeading()}
              onSelect={handleArchive}
              testID={`shell-worktree-archive-${row.key}`}
            >
              {t("workspace.menu.archiveWorkspace")}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  shell: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface0,
  },
  shellDimmed: {
    opacity: 0.55,
  },
  chevronSlot: {
    width: 18,
    marginLeft: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  chevron: {
    color: theme.colors.foregroundExtraMuted,
  },
  // 行体从 L1 的图标列起 (chevron 列 + 图标列的宽度对齐 L1 的标题)。
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  iconWrap: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  textWrap: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
