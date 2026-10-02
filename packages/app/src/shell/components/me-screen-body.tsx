// 我的 screen body (C31 extraction, C16 body pattern): the whole 我的 tab UI lifted
// out of (shell)/me.tsx so the tablet split can host a second instance in its left
// column. The thin route screen renders this verbatim on compact (§6 竖屏零回退);
// when the split is active it renders the detail placeholder and the column mounts
// this component instead. The §4-8 rail retap scrolls this ScrollView to top through
// rail-events (the column lives outside every navigator; no navigator hooks here).
//
// --- original screen notes (unchanged behaviour, card C8) ---
// 我的 tab (DESIGN §6, card C8): 概览卡 (N 主机 · M 项目 · K 活跃 agent, derived
// from the same subscriptions the workspace tab feeds) → 官方设置入口 (全局设置 +
// 每 host 一行，均 push 官方路由，D2 复用) → 壳设置 (壳模式开关 · 主题三选 · 默认
// 启动 tab · 清除本地数据) → 关于卡 (壳版本 + 上游 commit + 许可证外链).
// 壳模式/默认 tab 写 settings store，缝隙消费方在 src/app/index.tsx 与 (shell)/
// _layout，均重启生效；主题走官方 useAppSettings 覆盖口，即时生效。
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { ExternalLink } from "@/components/ui/external-link";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useAppSettings } from "@/hooks/use-settings";
import type { ThemePreference } from "@/styles/theme";
import { useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { buildShellAboutInfo } from "@/shell/about";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL_GO_VERSION, SHELL_MODE_ENV_DEFAULT } from "@/shell/config";
import { useShellUpdateStore, type ShellUpdatePhase } from "@/shell/update/state";
import { buildShellOverview } from "@/shell/overview";
import { OFFICIAL, SHELL_TAB } from "@/shell/routes";
import { RING_SLOT_ME, ringTabPathForSlot, type RingSlot } from "@/shell/gestures/tab-ring";
import { useShellRingSwipe } from "@/shell/gestures/use-shell-ring-swipe";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { clearPaseoGoLocalData, resetShellStores } from "@/shell/stores/clear-local-data";
import { usePaseoGoSettingsStore, type ShellTab } from "@/shell/stores/settings";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { confirmDialog } from "@/utils/confirm-dialog";
import { subscribeRailRetap } from "@/shell/tablet/rail-events";
import { ShellTabHeader } from "@/shell/components/shell-tab-header";

// Theme-fed Switch tints via the withUnistyles pattern (docs/unistyles.md §3).
const ThemedModeSwitch = withUnistyles(Switch, (theme) => ({
  trackColor: { false: theme.colors.surface3, true: theme.colors.accent },
  thumbColor: theme.colors.surface0,
}));

type ThemeChoice = "auto" | "light" | "dark";

const THEME_CHOICES: ThemeChoice[] = ["auto", "light", "dark"];
const DEFAULT_TABS: ShellTab[] = ["chats", "workspace", "me"];
// Official plugin/zinc preferences are outside the shell's 三选 → no chip lights up.
const THEME_CHOICE_BY_PREFERENCE: Partial<Record<ThemePreference, ThemeChoice>> = {
  auto: "auto",
  light: "light",
  dark: "dark",
};
const THEME_LABEL_KEY: Record<ThemeChoice, string> = {
  auto: "me.themeAuto",
  light: "me.themeLight",
  dark: "me.themeDark",
};

function tapHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// C12: 44dp chip target (module const — react-perf forbids per-render objects).
const CHIP_HIT_SLOP = { top: 8, bottom: 8 } as const;

// 列表行 (对齐官方设置页视觉): title + hint, trailing control (children) or chevron.
function SettingRow({
  title,
  hint,
  onPress,
  destructive,
  testID,
  children,
}: {
  title: string;
  hint?: string;
  onPress?: () => void;
  destructive?: boolean;
  testID: string;
  children?: ReactNode;
}) {
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, onPress && pressed && styles.rowPressed],
    [onPress],
  );
  const body = (
    <>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, destructive && styles.rowDestructive]} numberOfLines={1}>
          {title}
        </Text>
        {hint ? (
          <Text style={styles.muted} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children ?? (onPress ? <ChevronRight size={16} color={styles.muted.color} /> : null)}
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle({ pressed: false })}>
        {body}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={rowStyle}>
      {body}
    </Pressable>
  );
}

// 三选 chip 行内的单个选项 (own component so the press closure and style callback
// are per-chip stable refs, not per-render JSX-prop allocations).
function ChoiceChip({
  chipKey,
  label,
  active,
  testIdPrefix,
  onSelect,
}: {
  chipKey: string;
  label: string;
  active: boolean;
  testIdPrefix: string;
  onSelect: (key: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(chipKey), [onSelect, chipKey]);
  const chipStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.chip,
      active && styles.chipActive,
      pressed && styles.rowPressed,
    ],
    [active],
  );
  return (
    <Pressable
      testID={`${testIdPrefix}-${chipKey}`}
      accessibilityRole="button"
      accessibilityState={active ? ACCESSIBILITY_SELECTED : ACCESSIBILITY_UNSELECTED}
      hitSlop={CHIP_HIT_SLOP}
      onPress={handlePress}
      style={chipStyle}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const ACCESSIBILITY_SELECTED = { selected: true } as const;
const ACCESSIBILITY_UNSELECTED = { selected: false } as const;

function ChoiceChips({
  options,
  value,
  onSelect,
  testIdPrefix,
}: {
  options: { key: string; label: string }[];
  value: string | null;
  onSelect: (key: string) => void;
  testIdPrefix: string;
}) {
  return (
    <View style={styles.chipGroup}>
      {options.map((option) => (
        <ChoiceChip
          key={option.key}
          chipKey={option.key}
          label={option.label}
          active={option.key === value}
          testIdPrefix={testIdPrefix}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

// 官方 host 设置入口行: own component — the push closure binds the serverId here,
// keeping the list's JSX props allocation-free.
function HostSettingsRow({ host, online }: { host: HostProfile; online: boolean }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const handlePress = useCallback(
    () => router.push(OFFICIAL.hostSettings(host.serverId) as Href),
    [host.serverId],
  );
  return (
    <SettingRow
      title={host.label}
      hint={t(online ? "me.hostSettingsOnline" : "me.hostSettingsOffline")}
      onPress={handlePress}
      testID={`me-host-settings-${host.serverId}`}
    />
  );
}

// M4 slice 2: 「检查更新」行尾三态件 (own component: stable refs, no nested ternary)。
function UpdateRowTrailing({
  phase,
  latest,
  url,
}: {
  phase: ShellUpdatePhase;
  latest: string | null;
  url: string | null;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  if (phase === "checking") {
    return <Text style={styles.muted}>{t("update.checking")}</Text>;
  }
  if (phase === "available" && latest !== null && url !== null) {
    return <ExternalLink href={url} label={latest} testID="me-check-update-open" />;
  }
  return null;
}

export function MeScreenBody() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const toast = useToast();

  // C31 §4-8: rail retap = 回顶 — a real animated scrollTo on this ScrollView.
  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(
    () =>
      subscribeRailRetap((section) => {
        if (section === "me") scrollRef.current?.scrollTo({ y: 0, animated: true });
      }),
    [],
  );

  // 概览卡数据源 = 既有订阅 (无新 RPC)。
  const hosts = useHosts();
  const { projects, isLoading: projectsLoading } = useProjects();
  const { agents, isInitialLoad: agentsLoading } = useAggregatedAgents();
  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useShellHostStatuses(hostIds);
  // R2-21: M 项目 = the 工作区 tree's L1 rows (buildShellOverview derives it from
  // the same builder); R2-08①: 壳归档 agents leave 活跃.
  const archivedIds = usePaseoGoArchiveStore((state) => state.archivedIds);
  const overview = useMemo(
    () => buildShellOverview({ hosts, projects, agents, archivedIds }),
    [hosts, projects, agents, archivedIds],
  );
  const overviewLoading = projectsLoading || agentsLoading;

  // 壳设置 store (缝隙消费方: src/app/index.tsx 的 shellMode、_layout 的 defaultTab)。
  const shellMode = usePaseoGoSettingsStore((state) => state.shellMode);
  const setShellMode = usePaseoGoSettingsStore((state) => state.setShellMode);
  const defaultTab = usePaseoGoSettingsStore((state) => state.defaultTab);
  const setDefaultTab = usePaseoGoSettingsStore((state) => state.setDefaultTab);
  const notifications = usePaseoGoSettingsStore((state) => state.notifications);
  const setNotifications = usePaseoGoSettingsStore((state) => state.setNotifications);
  const shellModeActive = shellMode ?? SHELL_MODE_ENV_DEFAULT;

  // 主题走官方覆盖口：AppearanceProvider 订阅同一份 app settings，写入即生效。
  const { settings: appSettings, updateSettings } = useAppSettings();
  const themeChoice = THEME_CHOICE_BY_PREFERENCE[appSettings.theme] ?? null;

  const about = useMemo(() => buildShellAboutInfo(), []);
  const themeOptions = useMemo(
    () => THEME_CHOICES.map((key) => ({ key, label: t(THEME_LABEL_KEY[key]) })),
    [t],
  );
  const defaultTabOptions = useMemo(
    () => DEFAULT_TABS.map((tab) => ({ key: tab, label: t(`tabs.${tab}`) })),
    [t],
  );

  const handleOpenGlobalSettings = useCallback(() => router.push(OFFICIAL.settings as Href), []);
  const handleSelectTheme = useCallback(
    (key: string) => {
      tapHaptic();
      void updateSettings({ theme: key as ThemeChoice }).catch(() => {
        toast.show(t("me.themeFailed"));
      });
    },
    [updateSettings, toast, t],
  );
  const handleSelectDefaultTab = useCallback(
    (key: string) => {
      tapHaptic();
      setDefaultTab(key as ShellTab);
    },
    [setDefaultTab],
  );
  // C12: 开关切换补触觉（官方 Switch 不自发）。
  const handleToggleShellMode = useCallback(
    (value: boolean) => {
      tapHaptic();
      setShellMode(value);
    },
    [setShellMode],
  );
  const handleToggleNotifications = useCallback(
    (value: boolean) => {
      tapHaptic();
      setNotifications(value);
    },
    [setNotifications],
  );
  const handleClearData = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("me.clearConfirmTitle"),
      message: t("me.clearConfirmMessage"),
      confirmLabel: t("me.clearConfirm"),
      cancelLabel: t("me.clearCancel"),
      destructive: true,
    });
    if (!confirmed) return;
    await clearPaseoGoLocalData();
    resetShellStores();
    // C12: 成功触觉跟着真实完成，不再抢跑在清除之前。
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // 不运行中弹栈换 IA：shellMode 是启动期消费的缝隙，重启后官方首页自然接管
    // （Main 定稿）。原地留下，toast 说清重启语义；壳数据此刻已真实归零。
    toast.show(t("me.clearDone"));
  }, [t, toast]);
  const handleClearDataPress = useCallback(() => {
    void handleClearData();
  }, [handleClearData]);
  // M4 slice 2: 手动「检查更新」= 强拉 fork Releases + 三态 toast（当前/最新/已最新/
  // 失败）；发现新版时启动提示条也会重新可见（seen 标记未置位）。
  const updatePhase = useShellUpdateStore((state) => state.phase);
  const updateLatest = useShellUpdateStore((state) => state.latest);
  const updateUrl = useShellUpdateStore((state) => state.url);
  const runUpdateCheckNow = useShellUpdateStore((state) => state.runCheck);
  const reportUpdateCheck = useCallback(async () => {
    const result = await runUpdateCheckNow(true);
    if (!result) return; // 已有一次检查在飞，行内「检查中…」即反馈
    if (result.state === "available") {
      toast.show(t("update.found", { latest: result.latest ?? "", current: result.current }));
    } else if (result.state === "upToDate") {
      toast.show(t("update.upToDate", { current: result.current }));
    } else {
      toast.show(t("update.checkFailed"));
    }
  }, [runUpdateCheckNow, toast, t]);
  const handleCheckUpdatePress = useCallback(() => {
    tapHaptic();
    void reportUpdateCheck();
  }, [reportUpdateCheck]);

  // B8-SWIPE (批次八 F26): 我的 tab = 环的第 4 格（终点格的左右邻居是 已归档/
  // 进行中——环无边界）。落地只有官方 tab 动词一条路；本屏无搜索态/行拖拽，门空。
  const handleRingSlot = useCallback((target: RingSlot) => {
    router.navigate(ringTabPathForSlot(target) as Href);
  }, []);
  const ring = useShellRingSwipe({
    section: SHELL_TAB.me,
    slot: RING_SLOT_ME,
    blocked: false,
    onSwitchSlot: handleRingSlot,
  });

  return (
    <View style={styles.screen}>
      {/* KI-12: 标题行搬出 ScrollView——顶栏固定不随滚动，与对话/工作区等高。 */}
      <ShellTabHeader title={t("me.title")} />
      {/* B8-SWIPE: 换页面板=滚动体的父容器（对话 tab 同款拓扑，位移只动这层）。 */}
      <GestureDetector gesture={ring.gesture}>
        <Animated.View
          collapsable={false}
          style={[styles.swipeSurface, ring.surfaceStyle]}
          onLayout={ring.onSurfaceLayout}
        >
          <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.sectionHeader}>{t("me.overviewHeader")}</Text>
            <View style={styles.card} testID="me-overview">
              <Text style={styles.rowTitle}>
                {overviewLoading
                  ? t("me.overviewLoading")
                  : t("me.overview", {
                      hosts: overview.hostCount,
                      projects: overview.projectCount,
                      agents: overview.activeAgentCount,
                    })}
              </Text>
            </View>

            <Text style={styles.sectionHeader}>{t("me.officialHeader")}</Text>
            <View style={styles.card}>
              <SettingRow
                title={t("me.globalSettings")}
                hint={t("me.globalSettingsHint")}
                onPress={handleOpenGlobalSettings}
                testID="me-global-settings"
              />
              {hosts.map((host) => (
                <HostSettingsRow
                  key={host.serverId}
                  host={host}
                  online={(statuses.get(host.serverId) ?? "connecting") === "online"}
                />
              ))}
            </View>

            <Text style={styles.sectionHeader}>{t("me.shellModeHeader")}</Text>
            <View style={styles.card}>
              <SettingRow
                title={t("me.shellMode")}
                hint={t("me.shellModeHint", { env: SHELL_MODE_ENV_DEFAULT ? "on" : "off" })}
                testID="me-shell-mode-row"
              >
                <ThemedModeSwitch
                  testID="shell-mode-switch"
                  value={shellModeActive}
                  accessibilityLabel={t("me.shellMode")}
                  onValueChange={handleToggleShellMode}
                />
              </SettingRow>
              <View style={styles.divider} />
              <SettingRow title={t("me.theme")} hint={t("me.themeHint")} testID="me-theme-row">
                <ChoiceChips
                  options={themeOptions}
                  value={themeChoice}
                  onSelect={handleSelectTheme}
                  testIdPrefix="me-theme"
                />
              </SettingRow>
              <View style={styles.divider} />
              <SettingRow
                title={t("me.defaultTab")}
                hint={t("me.defaultTabHint")}
                testID="me-default-tab-row"
              >
                <ChoiceChips
                  options={defaultTabOptions}
                  value={defaultTab}
                  onSelect={handleSelectDefaultTab}
                  testIdPrefix="me-default-tab"
                />
              </SettingRow>
              <View style={styles.divider} />
              <SettingRow
                title={t("me.notifications")}
                hint={t("me.notificationsHint")}
                testID="me-notifications-row"
              >
                <ThemedModeSwitch
                  testID="shell-notify-switch"
                  value={notifications}
                  accessibilityLabel={t("me.notifications")}
                  onValueChange={handleToggleNotifications}
                />
              </SettingRow>
              <View style={styles.divider} />
              <SettingRow
                title={t("me.clearData")}
                hint={t("me.clearDataHint")}
                destructive
                onPress={handleClearDataPress}
                testID="me-clear-data"
              />
            </View>

            <Text style={styles.sectionHeader}>{t("me.aboutHeader")}</Text>
            <View style={styles.card} testID="me-about">
              <SettingRow
                title={t("me.shellVersion", { version: about.version })}
                hint={t("me.upstream", { ref: about.upstreamRef })}
                testID="me-about-row"
              >
                <ExternalLink href={about.licenseUrl} label={t("me.license")} testID="me-license" />
              </SettingRow>
              <View style={styles.divider} />
              <SettingRow
                title={t("me.checkUpdate")}
                hint={t("me.checkUpdateHint", { version: SHELL_GO_VERSION })}
                onPress={handleCheckUpdatePress}
                testID="me-check-update"
              >
                <UpdateRowTrailing phase={updatePhase} latest={updateLatest} url={updateUrl} />
              </SettingRow>
            </View>
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  // B8-SWIPE: 换页面板（对话 tab 同款：flex:1 不塌尺寸，overflow:hidden 裁墙外）。
  swipeSurface: {
    flex: 1,
    overflow: "hidden",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[2],
  },
  sectionHeader: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[1],
    textTransform: "uppercase",
  },
  card: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowBody: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowDestructive: {
    color: theme.colors.palette.red[500],
  },
  divider: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing[4],
  },
  chipGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  chip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  chipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  chipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  chipTextActive: {
    color: theme.colors.surface0,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
