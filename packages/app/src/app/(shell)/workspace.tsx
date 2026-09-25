// Workspace tab — C1 skeleton. Probes A3: the official FileExplorerPane accepts an
// `onOpenFile` callback, so the shell can override "open" into a Stack push (C6).
// The probe mounts the real pane for the first online project and shows the last
// path the callback fired with. C5 replaces this with the host/project tree.
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { useProjects } from "@/hooks/use-projects";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

export default function ShellWorkspaceScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const { projects, isLoading } = useProjects();
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const handleOpenFile = useCallback((filePath: string) => setOpenedPath(filePath), []);

  const target = projects.flatMap((project) => project.hosts).find((host) => host.isOnline);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>{t("workspace.title")}</Text>
        <Text style={styles.sectionHeader}>{t("workspace.probeHeader")}</Text>
        {target ? (
          <Text style={styles.muted}>
            {t("workspace.projectLine", {
              project: target.projectName,
              host: target.serverName,
            })}
          </Text>
        ) : (
          <Text style={styles.muted}>{isLoading ? "…" : t("workspace.noProject")}</Text>
        )}
        {openedPath ? (
          <Text testID="shell-a3-opened" style={styles.opened}>
            {t("workspace.openedLine", { path: openedPath })}
          </Text>
        ) : null}
      </View>
      {target ? (
        <FileExplorerPane
          serverId={target.serverId}
          workspaceId={target.workspaces[0]?.id}
          workspaceRoot={target.repoRoot}
          onOpenFile={handleOpenFile}
        />
      ) : (
        <ScrollView />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[1],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  sectionHeader: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  opened: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
  },
}));
