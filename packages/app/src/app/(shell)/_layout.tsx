// Paseo Go shell tabs (DESIGN.md §3): 对话 / 工作区 / 我的. Screens are C1 skeleton
// probes; later cards fill them. All chrome uses official Unistyles tokens (§2.5);
// theme-fed non-style props follow the ThemedStack withUnistyles pattern.
import { ShellSessionHeaderOverlay } from "@/shell/components/shell-session-header";
import { Tabs, useNavigation } from "expo-router";
import { FolderTree, MessageCircle, User } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShellWindowCompact } from "@/shell/tablet/form-factor";
import { useShellNotifications } from "@/shell/notify/use-shell-notifications";
import { useOwnershipSendGuard } from "@/shell/composer/use-ownership-send-guard";
import { ShellUpdateBanner } from "@/shell/components/shell-update-banner";
import { useShellUpdateCheck } from "@/shell/update/use-shell-update-check";
import { ensureShellI18n, SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { usePaseoGoSettingsStore, type ShellTab } from "@/shell/stores/settings";
import { focusedShellTab, type NavStateLike } from "@/shell/focused-tab";
import { setShellFrontmostSection } from "@/shell/gestures/ring-transition";

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
  // C30 (DESIGN-tablet.md §3.2-1): on wide screens the bottom bar is replaced by
  // the ShellTabletSplitHost nav rail, so it is hidden — Tabs skeleton and the
  // lastFocusedTab recovery below all stay as-is.
  // C31-F1 (C32): same window-dimension source as the split host itself — a
  // runtime rotation flips bar and split in the same frame (the Unistyles
  // breakpoint stayed stale portrait→landscape and left the bar visible mid-split).
  const isCompact = useShellWindowCompact();
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: activeTint,
      tabBarInactiveTintColor: inactiveTint,
      tabBarStyle: isCompact ? styles.tabBar : styles.tabBarHidden,
      tabBarLabelStyle: styles.tabLabel,
      sceneStyle: styles.scene,
      // KI-9: compact tab switches cross-fade (bottom-tabs v7 `animation:
      // "fade"` — FadeSpec is a 150ms timing, the same beat as the wide
      // list-column crossfade, SECTION_FADE_MS). Wide keeps "none": the bar is
      // hidden there and the rail's section switch is animated by the list
      // column itself.
      animation: (isCompact ? "fade" : "none") as "fade" | "none",
    }),
    [activeTint, inactiveTint, isCompact],
  );
  const chatsOptions = useMemo(() => ({ title: chats, tabBarIcon: ChatsTabIcon }), [chats]);
  const workspaceOptions = useMemo(
    () => ({ title: workspace, tabBarIcon: WorkspaceTabIcon }),
    [workspace],
  );
  const meOptions = useMemo(() => ({ title: me, tabBarIcon: MeTabIcon }), [me]);
  // KI-9: the former hidden-tab screens (files/commands/edit/import/rename) now
  // live in the (detail) root stack — real pushes with the native slide-in. The
  // group carries only the three tabs plus the cold-start index below.
  const hiddenIndexOptions = useMemo(() => ({ href: null }), []);

  return (
    <Tabs initialRouteName={initialRouteName} screenOptions={screenOptions}>
      {/* C8 cold-start dispatcher (index.tsx): resolvable at /(shell) but never a
          visible tab — it redirects straight to the 默认启动 tab. */}
      <Tabs.Screen name="index" options={hiddenIndexOptions} />
      <Tabs.Screen name="chats" options={chatsOptions} />
      <Tabs.Screen name="workspace" options={workspaceOptions} />
      <Tabs.Screen name="me" options={meOptions} />
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

  // C11: attention watcher lives on the tabs layout, so it runs on every shell tab.
  useShellNotifications();
  // B4-OWNERSHIP-UI (ruling 14): R4 send guard — wraps the runtime clients'
  // sendAgentMessage for exactly as long as the shell tabs live (the session
  // screen rides on top of this layout, so the guard covers composer sends).
  useOwnershipSendGuard();
  // M4 slice 2: startup update probe (one per JS context; silent on failure —
  // the 我的 row is the visible retry affordance).
  useShellUpdateCheck();
  useEffect(() => {
    // F3: useNavigation resolves to the root stack — the active tab lives one level
    // deeper (focusedShellTab). Null while a (detail) push is on top (KI-9): the
    // tabs group is not focused and must not overwrite the remembered position.
    const record = () => {
      const tab = focusedShellTab(navigation.getState() as unknown as NavStateLike | undefined);
      if (tab) lastFocusedTab = tab;
      // B8-SWIPE: the same beat drives the ring's frontmost bus — the ONLY focus
      // source that sees tabs on compact AND wide (the split column lives outside
      // every navigator). null while a (detail)/official push is on top ⇒ the tab
      // screens' ring gestures stand down (堆叠页返回优先, F27).
      setShellFrontmostSection(tab);
    };
    record();
    return navigation.addListener("state", record);
  }, [navigation]);

  return (
    <View style={styles.updateRoot}>
      <ShellSessionHeaderOverlay />
      {/* M4 slice 2: 一次性升级提示条 — flexes the tab area down while visible. */}
      <ShellUpdateBanner />
      <View style={styles.tabsHost}>
        <ThemedShellTabs
          initialRouteName={lastFocusedTab ?? defaultTab}
          chats={t("tabs.chats")}
          workspace={t("tabs.workspace")}
          me={t("tabs.me")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  updateRoot: {
    flex: 1,
  },
  tabsHost: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: theme.colors.surface0,
    borderTopColor: theme.colors.border,
  },
  tabBarHidden: {
    display: "none" as const,
  },
  tabLabel: {
    fontSize: theme.fontSize.sm,
  },
  scene: {
    backgroundColor: theme.colors.surface0,
  },
}));
