// Paseo Go shell tabs (DESIGN.md §3): 对话 / 工作区 / 我的. Screens are C1 skeleton
// probes; later cards fill them. All chrome uses official Unistyles tokens (§2.5);
// theme-fed non-style props follow the ThemedStack withUnistyles pattern.
import { Tabs } from "expo-router";
import { FolderTree, MessageCircle, User } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ensureShellI18n, SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";

ensureShellI18n();

interface ShellTabTitles {
  chats: string;
  workspace: string;
  me: string;
}

interface ShellTabsProps extends ShellTabTitles {
  initialRouteName: "chats" | "workspace" | "me";
  activeTint: string;
  inactiveTint: string;
}

function ChatsTabIcon({ color, size }: { color: string; size: number }) {
  return <MessageCircle size={size} color={color} />;
}

function WorkspaceTabIcon({ color, size }: { color: string; size: number }) {
  return <FolderTree size={size} color={color} />;
}

function MeTabIcon({ color, size }: { color: string; size: number }) {
  return <User size={size} color={color} />;
}

function ShellTabsBase({
  initialRouteName,
  activeTint,
  inactiveTint,
  chats,
  workspace,
  me,
}: ShellTabsProps) {
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: activeTint,
      tabBarInactiveTintColor: inactiveTint,
      tabBarStyle: styles.tabBar,
      tabBarLabelStyle: styles.tabLabel,
      sceneStyle: styles.scene,
    }),
    [activeTint, inactiveTint],
  );
  const chatsOptions = useMemo(() => ({ title: chats, tabBarIcon: ChatsTabIcon }), [chats]);
  const workspaceOptions = useMemo(
    () => ({ title: workspace, tabBarIcon: WorkspaceTabIcon }),
    [workspace],
  );
  const meOptions = useMemo(() => ({ title: me, tabBarIcon: MeTabIcon }), [me]);
  // C5 files screen: the tree row's full-screen push target. It rides the group's
  // route tree but must never surface as a tab — hidden from the bar, and the bar
  // itself is suppressed while it is focused (reads as a Stack push over the tabs).
  const filesOptions = useMemo(
    () => ({ href: null, tabBarStyle: { display: "none" as const } }),
    [],
  );

  return (
    <Tabs initialRouteName={initialRouteName} screenOptions={screenOptions}>
      <Tabs.Screen name="chats" options={chatsOptions} />
      <Tabs.Screen name="workspace" options={workspaceOptions} />
      <Tabs.Screen name="me" options={meOptions} />
      <Tabs.Screen name="files/[serverId]/[workspaceId]" options={filesOptions} />
    </Tabs>
  );
}

const ThemedShellTabs = withUnistyles(ShellTabsBase, (theme) => ({
  activeTint: theme.colors.accent,
  inactiveTint: theme.colors.foregroundMuted,
}));

export default function ShellTabsLayout() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const defaultTab = usePaseoGoSettingsStore((state) => state.defaultTab);

  return (
    <ThemedShellTabs
      initialRouteName={defaultTab}
      chats={t("tabs.chats")}
      workspace={t("tabs.workspace")}
      me={t("tabs.me")}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  tabBar: {
    backgroundColor: theme.colors.surface0,
    borderTopColor: theme.colors.border,
  },
  tabLabel: {
    fontSize: theme.fontSize.sm,
  },
  scene: {
    backgroundColor: theme.colors.surface0,
  },
}));
