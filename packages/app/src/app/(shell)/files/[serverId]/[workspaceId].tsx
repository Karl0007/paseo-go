// Files 占位屏 (card C5): the tree's row target. C6 replaces the body with the
// official FileExplorerPane; for now it proves the route contract — breadcrumb-style
// header (host › project › workspace) over the workspace root path. The group
// layout declares it href-hidden with the tab bar suppressed while focused, so it
// reads as a full-screen push over the tabs.
import { useCallback } from "react";
import { BackHandler, Platform, Pressable, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChevronLeft, FolderOpen } from "lucide-react-native";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL_TAB } from "@/shell/routes";

export default function ShellFilesPlaceholderScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const { serverId, workspaceId } = useLocalSearchParams<{
    serverId: string;
    workspaceId: string;
  }>();
  const hosts = useHosts();
  const workspace = useSessionStore((state) =>
    serverId && workspaceId ? state.sessions[serverId]?.workspaces.get(workspaceId) : undefined,
  );

  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId ?? "";
  const workspaceName = workspace?.title?.trim() || workspace?.name || workspaceId || "";
  const rootPath = workspace?.workspaceDirectory || workspace?.projectRootPath || "";

  // The screen is a hidden tab: a path navigate could pop unrelated root-stack
  // screens (restored deep links), so both affordances jump through the tab
  // navigator itself — it only switches tabs, never pops the stack. The hardware
  // listener lives only while focused (official workspace-screen.tsx pattern).
  const handleBack = useCallback(
    () => navigation.navigate({ name: SHELL_TAB.workspace } as never),
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        navigation.navigate({ name: SHELL_TAB.workspace } as never);
        return true;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.back}
          testID="shell-files-back"
        >
          <ChevronLeft size={22} color={styles.backIcon.color} />
        </Pressable>
        <View style={styles.crumbs} testID="shell-files-breadcrumbs">
          <Text style={styles.crumbMuted} numberOfLines={1}>
            {hostLabel}
          </Text>
          {workspace ? (
            <>
              <Text style={styles.crumbSep}>›</Text>
              <Text style={styles.crumbMuted} numberOfLines={1}>
                {workspace.projectCustomName?.trim() || workspace.projectDisplayName}
              </Text>
              <Text style={styles.crumbSep}>›</Text>
            </>
          ) : null}
          <Text style={styles.crumbCurrent} numberOfLines={1}>
            {workspaceName}
          </Text>
        </View>
      </View>
      <View style={styles.body}>
        {workspace ? (
          <>
            <View style={styles.pathCard} testID="shell-files-root-path">
              <Text style={styles.pathLabel}>{t("files.rootPathLabel")}</Text>
              <Text style={styles.pathValue}>{rootPath || t("files.pathUnknown")}</Text>
            </View>
            <View style={styles.hintWrap}>
              <FolderOpen size={22} color={styles.hintIcon.color} />
              <Text style={styles.hint}>{t("files.placeholderHint")}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.missing} testID="shell-files-missing">
            {t("files.notFound")}
          </Text>
        )}
      </View>
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
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  back: {
    padding: theme.spacing[1],
  },
  backIcon: {
    color: theme.colors.foreground,
  },
  crumbs: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  crumbMuted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    maxWidth: "34%",
  },
  crumbSep: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  crumbCurrent: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  body: {
    flex: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  pathCard: {
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  pathLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  pathValue: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  hintWrap: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[8],
  },
  hintIcon: {
    color: theme.colors.foregroundMuted,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  missing: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    paddingTop: theme.spacing[8],
  },
}));
