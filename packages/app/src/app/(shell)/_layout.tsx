// Paseo Go shell tabs (DESIGN.md §3): 对话 / 工作区 / 我的. Screens are C1 skeleton
// probes; later cards fill them. All chrome uses official Unistyles tokens (§2.5);
// theme-fed non-style props follow the ThemedStack withUnistyles pattern.
import { Tabs, useNavigation } from "expo-router";
import { FolderTree, MessageCircle, User } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ensureShellI18n, SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { usePaseoGoSettingsStore, type ShellTab } from "@/shell/stores/settings";

ensureShellI18n();

// The root stack wraps every screen's content in an AppearanceStyleBoundary (the
// official Unistyles fix: theme-token changes remount content below the navigator —
// see navigation/themed-stack.tsx). The (shell) group is a navigator, so a theme
// switch remounts it and Tabs would restart at initialRouteName, throwing the user
// off their tab. Remember the focused tab in module memory so the boundary remount
// (and the cold-start dispatcher below, when it re-fires on that remount) reopens
// where the user stood; a real process restart starts fresh from the defaultTab
// setting (module state dies with the JS context).
let lastFocusedTab: ShellTab | null = null;
export function shellLastFocusedTab(): ShellTab | null {
  return lastFocusedTab;
}
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
  // C5/C7 full-screen pushes inside the group: the files tree and the 快捷指令
  // form ride the group's route tree but must never surface as tabs — hidden from
  // the bar, and the bar itself is suppressed while they are focused (they read
  // as Stack pushes over the tabs).
  const hiddenScreenOptions = useMemo(
    () => ({ href: null, tabBarStyle: { display: "none" as const } }),
    [],
  );

  return (
    <Tabs initialRouteName={initialRouteName} screenOptions={screenOptions}>
      {/* C8 cold-start dispatcher (index.tsx): resolvable at /(shell) but never a
          visible tab — it redirects straight to the 默认启动 tab. */}
      <Tabs.Screen name="index" options={hiddenScreenOptions} />
      <Tabs.Screen name="chats" options={chatsOptions} />
      <Tabs.Screen name="workspace" options={workspaceOptions} />
      <Tabs.Screen name="me" options={meOptions} />
      <Tabs.Screen name="files/[serverId]/[workspaceId]" options={hiddenScreenOptions} />
      <Tabs.Screen name="commands/edit" options={hiddenScreenOptions} />
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
  const navigation = useNavigation();

  useEffect(() => {
    // Focused route, or null on a hidden push (files/commands) — those aren't tabs,
    // so they must not overwrite the remembered position.
    const record = () => {
      const state = navigation.getState();
      const name = state ? state.routes[state.index]?.name : undefined;
      if (name === "chats" || name === "workspace" || name === "me") lastFocusedTab = name;
    };
    record();
    return navigation.addListener("state", record);
  }, [navigation]);

  return (
    <ThemedShellTabs
      initialRouteName={lastFocusedTab ?? defaultTab}
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
