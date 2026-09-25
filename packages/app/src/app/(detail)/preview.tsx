// 预览屏 (card C6, DESIGN §5): pushed onto the (detail) root stack by the files
// screen and the 工作区 favorites rows. Type dispatch is the pure `previewKind`;
// image/markdown/html/code/text mount the official FilePane pipeline unchanged
// (ZoomableImage pinch-zoom, markdown renderer, CSP webview, highlighted read-only
// source, its own too-large budget). video/binary/large-text get the shell info
// card with the official download-store pipeline as the action rail. The stat pass
// (official listDirectory RPC on the parent dir) supplies size/mtime for the card
// and the >5MB text gate; if the host is offline the extension-only plan still
// renders and FilePane shows its own disconnected state.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  ChevronLeft,
  Download,
  FileArchive,
  FileText,
  Film,
  MoreVertical,
  Share2,
  Star,
} from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { FilePane } from "@/file-pane/pane";
import { useFileDownload } from "@/hooks/use-file-download";
import { useSessionStore } from "@/stores/session-store";
import { parentExplorerPath } from "@/utils/explorer-paths";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL } from "@/shell/routes";
import { previewKind, type ShellPreviewPlan } from "@/shell/files/preview-kind";
import { formatShellFileSize } from "@/shell/files/format-size";
import { useShellFileActions, type ShellFileTarget } from "@/shell/files/use-shell-file-actions";
import { ShellFileOverflowMenu } from "@/shell/components/file-action-menu";

interface FileStat {
  size: number;
  mtime: string;
}

interface CardRow {
  label: string;
  value: string;
}

function InfoRow({ label, value }: CardRow) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

// Shared body for video/binary/large-text: what the file is + the official
// download pipeline as big primary actions.
function FileCard({
  Icon,
  testID,
  hint,
  rows,
  onDownload,
  onShare,
}: {
  Icon: typeof FileArchive;
  testID: string;
  hint: string;
  rows: CardRow[];
  onDownload: () => void;
  onShare: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <ScrollView
      style={styles.cardScroll}
      contentContainerStyle={styles.cardContent}
      testID={testID}
    >
      <View style={styles.cardIconWrap}>
        <Icon size={40} color={styles.cardIcon.color} />
      </View>
      <Text style={styles.cardHint}>{hint}</Text>
      <View style={styles.cardInfo}>
        {rows.map((row) => (
          <InfoRow key={row.label} label={row.label} value={row.value} />
        ))}
      </View>
      <Button
        variant="default"
        size="lg"
        onPress={onDownload}
        testID={`${testID}-download`}
        style={styles.cardButton}
      >
        <Download size={16} color={styles.cardButtonText.color} />
        <Text style={styles.cardButtonText}>{t("files.menu.download")}</Text>
      </Button>
      <Button
        variant="outline"
        size="lg"
        onPress={onShare}
        testID={`${testID}-share`}
        style={styles.cardButton}
      >
        <Share2 size={16} color={styles.cardButtonTextOutline.color} />
        <Text style={styles.cardButtonTextOutline}>{t("files.menu.share")}</Text>
      </Button>
    </ScrollView>
  );
}

interface PreviewBodyProps {
  plan: ShellPreviewPlan;
  serverId: string;
  workspaceRoot: string;
  filePath: string;
  fileName: string;
  stat: FileStat | null;
  onDownload: () => void;
}

// Dispatch half of the ruling: FilePane for everything the official pipeline can
// render, the info card for video/binary/large-text. Split out of the screen so
// each surface stays readable.
function PreviewBody({
  plan,
  serverId,
  workspaceRoot,
  filePath,
  fileName,
  stat,
  onDownload,
}: PreviewBodyProps): ReactElement {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const cardRows = useMemo<CardRow[]>(() => {
    const rows: CardRow[] = [{ label: t("preview.card.name"), value: fileName }];
    if (plan.largeText) {
      if (stat) rows.push({ label: t("preview.card.size"), value: formatShellFileSize(stat.size) });
      return rows;
    }
    rows.push(
      {
        label: t("preview.card.size"),
        value: stat ? formatShellFileSize(stat.size) : "—",
      },
      {
        label: t("preview.card.modified"),
        value: stat?.mtime ? new Date(stat.mtime).toLocaleString() : "—",
      },
      { label: t("preview.card.type"), value: t(`preview.type.${plan.kind}`) },
    );
    return rows;
  }, [plan.kind, plan.largeText, stat, fileName, t]);
  const location = useMemo(() => ({ path: filePath }), [filePath]);

  if (plan.largeText) {
    return (
      <FileCard
        Icon={FileText}
        testID="shell-preview-large-text"
        hint={t("preview.largeTextHint")}
        rows={cardRows}
        onDownload={onDownload}
        onShare={onDownload}
      />
    );
  }
  if (plan.kind === "video") {
    return (
      <FileCard
        Icon={Film}
        testID="shell-preview-video-card"
        hint={t("preview.videoHint")}
        rows={cardRows}
        onDownload={onDownload}
        onShare={onDownload}
      />
    );
  }
  if (plan.kind === "binary") {
    return (
      <FileCard
        Icon={FileArchive}
        testID="shell-preview-binary-card"
        hint={t("preview.binaryHint")}
        rows={cardRows}
        onDownload={onDownload}
        onShare={onDownload}
      />
    );
  }
  return (
    <FilePane
      key={`${serverId}:${workspaceRoot}:${filePath}`}
      serverId={serverId}
      workspaceRoot={workspaceRoot}
      location={location}
      navigationRevision={0}
    />
  );
}

export default function ShellPreviewScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    serverId?: string;
    workspaceId?: string;
    path?: string;
    name?: string;
    workspaceRoot?: string;
  }>();
  const serverId = params.serverId ?? "";
  const workspaceId = params.workspaceId ?? "";
  const filePath = params.path ?? "";
  const fileName = params.name || filePath.split(/[/\\]/).pop() || filePath;

  const workspace = useSessionStore((state) =>
    serverId && workspaceId ? state.sessions[serverId]?.workspaces.get(workspaceId) : undefined,
  );
  const client = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.client ?? null) : null,
  );
  const workspaceRoot = (
    params.workspaceRoot?.trim() ||
    workspace?.workspaceDirectory ||
    workspace?.projectRootPath ||
    ""
  ).trim();

  // Size/mtime via the official listDirectory RPC on the parent directory — the
  // same call the explorer rows use; never a full read just to stat.
  const [stat, setStat] = useState<FileStat | null>(null);
  useEffect(() => {
    setStat(null);
    if (!client || !workspaceRoot || !filePath) return undefined;
    let disposed = false;
    void (async () => {
      try {
        const directory = await client.listDirectory(workspaceRoot, parentExplorerPath(filePath));
        const entry = directory.entries.find((candidate) => candidate.path === filePath);
        if (!disposed && entry) setStat({ size: entry.size, mtime: entry.modifiedAt });
      } catch {
        // No stat: the extension-only plan still renders; cards show "—".
      }
    })();
    return () => {
      disposed = true;
    };
  }, [client, workspaceRoot, filePath]);

  const plan = previewKind(filePath, stat?.size ?? 0);

  const target = useMemo<ShellFileTarget>(
    () => ({
      hostId: serverId,
      workspaceId,
      workspaceRoot,
      path: filePath,
      name: fileName,
      size: stat?.size,
      mtime: stat?.mtime,
    }),
    [serverId, workspaceId, workspaceRoot, filePath, fileName, stat],
  );
  const fileActions = useShellFileActions(target);
  const downloadFile = useFileDownload({ serverId, workspaceId, workspaceRoot });
  const runDownload = useCallback(() => {
    downloadFile({ fileName, path: filePath });
  }, [downloadFile, fileName, filePath]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(SHELL.workspace as Href);
  }, []);

  const menuActions = useMemo(
    () => ({
      isFavorite: fileActions.isFavorite,
      onToggleFavorite: fileActions.toggleFavorite,
      onDownload: runDownload,
      onShare: runDownload,
      onCopyPath: () => {
        void fileActions.copyAbsolutePath();
      },
      onAddToChat: () => {
        void fileActions.addToChat();
      },
    }),
    [fileActions, runDownload],
  );
  const overflowTrigger = useMemo(
    () => <MoreVertical size={20} color={styles.actionIcon.color} />,
    [],
  );

  let body: ReactElement;
  if (!serverId || !filePath) {
    body = (
      <Text style={styles.missing} testID="shell-preview-missing">
        {t("preview.missing")}
      </Text>
    );
  } else if (!workspaceRoot) {
    body = (
      <Text style={styles.missing} testID="shell-preview-missing">
        {t("files.notFound")}
      </Text>
    );
  } else {
    body = (
      <PreviewBody
        plan={plan}
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        filePath={filePath}
        fileName={fileName}
        stat={stat}
        onDownload={runDownload}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.back}
          testID="shell-preview-back"
        >
          <ChevronLeft size={22} color={styles.backIcon.color} />
        </Pressable>
        <View style={styles.crumbs}>
          <Text style={styles.title} numberOfLines={1} testID="shell-preview-title">
            {fileName}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {filePath}
          </Text>
        </View>
        <Pressable
          onPress={fileActions.toggleFavorite}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.action}
          testID="shell-preview-favorite"
        >
          <Star
            size={20}
            color={fileActions.isFavorite ? styles.favoriteActive.color : styles.actionIcon.color}
            fill={fileActions.isFavorite ? styles.favoriteActive.color : "transparent"}
          />
        </Pressable>
        <ShellFileOverflowMenu
          actions={menuActions}
          title={fileName}
          testID="shell-preview-menu"
          trigger={overflowTrigger}
        />
      </View>
      <View style={styles.body}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  back: {
    padding: theme.spacing[1],
  },
  backIcon: {
    color: theme.colors.foreground,
  },
  crumbs: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  action: {
    padding: theme.spacing[1],
  },
  actionIcon: {
    color: theme.colors.foregroundMuted,
  },
  favoriteActive: {
    color: theme.colors.accent,
  },
  body: {
    flex: 1,
  },
  missing: {
    padding: theme.spacing[6],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  cardScroll: {
    flex: 1,
  },
  cardContent: {
    padding: theme.spacing[6],
    gap: theme.spacing[4],
    alignItems: "stretch",
  },
  cardIconWrap: {
    alignSelf: "center",
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  cardIcon: {
    color: theme.colors.foregroundMuted,
  },
  cardHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  cardInfo: {
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  infoLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  infoValue: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    textAlign: "right",
  },
  cardButton: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  cardButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  cardButtonTextOutline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
