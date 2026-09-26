// File action menus (card C6): the ruling's action set — 收藏｜下载｜分享｜复制路径｜
// 添加到对话 — on the official menu engine (docs/menus.md), in its anchored-popover
// presentation (C19, DESIGN §14.3: none of these pages takes input, so the compact
// popover is the right shape). Two shapes share one row list: the preview screen's
// overflow (press-to-open DropdownMenu) and the 工作区 favorites rows' long-press
// ContextMenu (取消收藏/分享/复制路径 subset). 下载 and 分享 both ride the official
// download-store pipeline — on native it ends in the system share sheet, which
// is also how a downloaded file is opened elsewhere.
import { useCallback, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import * as Haptics from "expo-haptics";
import { Copy, Download, MessageSquarePlus, Share2, Star, StarOff } from "lucide-react-native";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

export interface ShellFileMenuActions {
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onShare: () => void;
  onCopyPath: () => void;
  onAddToChat?: (() => void) | undefined;
}

const ThemedStar = withUnistyles(Star, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedStarOff = withUnistyles(StarOff, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedDownload = withUnistyles(Download, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedShare = withUnistyles(Share2, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedCopy = withUnistyles(Copy, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedChat = withUnistyles(MessageSquarePlus, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

type RowId = "favorite" | "unfavorite" | "download" | "share" | "copyPath" | "addToChat";

// Icons ride the engine's muted rail; built through a helper so no JSX crosses a
// prop boundary per render (chat-row-menu pattern).
function menuLeading(id: RowId): ReactElement {
  switch (id) {
    case "favorite":
      return <ThemedStar size={16} />;
    case "unfavorite":
      return <ThemedStarOff size={16} />;
    case "download":
      return <ThemedDownload size={16} />;
    case "share":
      return <ThemedShare size={16} />;
    case "copyPath":
      return <ThemedCopy size={16} />;
    case "addToChat":
      return <ThemedChat size={16} />;
  }
}

// Stable-handler rows: the engine takes selection through `selectItem`, so inline
// arrows would rebuild every row closure on each parent render (chat-row-menu pattern).
function MenuRow({
  leading,
  label,
  onSelect,
  testID,
}: {
  leading: ReactElement;
  label: string;
  onSelect: () => void;
  testID: string;
}): ReactElement {
  return (
    <ContextMenuItem leading={leading} onSelect={onSelect} testID={testID}>
      {label}
    </ContextMenuItem>
  );
}

function fileMenuRows(
  actions: ShellFileMenuActions,
  labels: Record<RowId, string>,
  testIDPrefix: string,
  subset: "full" | "favoriteRow",
): ReactElement[] {
  const rows: ReactElement[] = [];
  if (actions.isFavorite) {
    rows.push(
      <MenuRow
        key="unfavorite"
        leading={menuLeading("unfavorite")}
        label={labels.unfavorite}
        onSelect={actions.onToggleFavorite}
        testID={`${testIDPrefix}-unfavorite`}
      />,
    );
  } else if (subset === "full") {
    rows.push(
      <MenuRow
        key="favorite"
        leading={menuLeading("favorite")}
        label={labels.favorite}
        onSelect={actions.onToggleFavorite}
        testID={`${testIDPrefix}-favorite`}
      />,
    );
  }
  if (subset === "full") {
    rows.push(
      <MenuRow
        key="download"
        leading={menuLeading("download")}
        label={labels.download}
        onSelect={actions.onDownload}
        testID={`${testIDPrefix}-download`}
      />,
      <MenuRow
        key="share"
        leading={menuLeading("share")}
        label={labels.share}
        onSelect={actions.onShare}
        testID={`${testIDPrefix}-share`}
      />,
    );
  } else {
    rows.push(
      <MenuRow
        key="share"
        leading={menuLeading("share")}
        label={labels.share}
        onSelect={actions.onShare}
        testID={`${testIDPrefix}-share`}
      />,
    );
  }
  rows.push(
    <MenuRow
      key="copyPath"
      leading={menuLeading("copyPath")}
      label={labels.copyPath}
      onSelect={actions.onCopyPath}
      testID={`${testIDPrefix}-copy-path`}
    />,
  );
  if (subset === "full" && actions.onAddToChat) {
    rows.push(
      <MenuRow
        key="addToChat"
        leading={menuLeading("addToChat")}
        label={labels.addToChat}
        onSelect={actions.onAddToChat}
        testID={`${testIDPrefix}-add-to-chat`}
      />,
    );
  }
  return rows;
}

function useFileMenuLabels(): Record<RowId, string> {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return {
    favorite: t("files.menu.favorite"),
    unfavorite: t("files.menu.unfavorite"),
    download: t("files.menu.download"),
    share: t("files.menu.share"),
    copyPath: t("files.menu.copyPath"),
    addToChat: t("files.menu.addToChat"),
  };
}

/** Press-to-open overflow with the full action set (preview screen header). */
export function ShellFileOverflowMenu({
  actions,
  title,
  trigger,
  testID,
}: {
  actions: ShellFileMenuActions;
  title: string;
  trigger: ReactNode;
  testID: string;
}): ReactElement {
  const labels = useFileMenuLabels();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID={testID}
        accessibilityRole="button"
        hitSlop={12}
        accessibilityLabel={title}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent sheetTitle={title} width={280}>
        {fileMenuRows(actions, labels, testID, "full")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Long-press menu for a favorites row: 取消收藏/分享/复制路径. */
export function ShellFavoriteRowMenu({
  actions,
  title,
  onPress,
  testID,
  accessibilityLabel,
  children,
}: {
  actions: ShellFileMenuActions;
  title: string;
  onPress: () => void;
  testID: string;
  /** C12: row-level label (标题+状态) — the trigger IS the row. */
  accessibilityLabel?: string;
  children: ReactNode;
}): ReactElement {
  const labels = useFileMenuLabels();
  // C12: the official engine fires no haptics itself; long-press-open gets the
  // same selection tick the chat rows use.
  const handleLongPress = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
  }, []);
  return (
    // The ContextMenu wrapper defaults its compact mode to sheet; C19 opts this
    // row menu into the anchored popover explicitly (docs/menus.md).
    <ContextMenu compactMode="popover">
      <ContextMenuTrigger
        onPress={onPress}
        onLongPress={handleLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent sheetTitle={title} width={280}>
        {fileMenuRows(actions, labels, testID, "favoriteRow")}
      </ContextMenuContent>
    </ContextMenu>
  );
}
