// Me tab — C1 skeleton. Hosts the runtime shell-mode switch (DESIGN.md §2.1: the
// seam reads `paseoGo.settings.shellMode` first, env default second) and the about
// card. C8 builds the full 我的 screen on top of this store.
import { ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SHELL_MODE_ENV_DEFAULT, SHELL_UPSTREAM_REF, SHELL_VERSION } from "@/shell/config";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { usePaseoGoSettingsStore } from "@/shell/stores/settings";

// Theme-fed Switch tints via the withUnistyles pattern (docs/unistyles.md §3).
const ThemedModeSwitch = withUnistyles(Switch, (theme) => ({
  trackColor: { false: theme.colors.surface3, true: theme.colors.accent },
  thumbColor: theme.colors.surface0,
}));

export default function ShellMeScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);

  const insets = useSafeAreaInsets();
  const shellMode = usePaseoGoSettingsStore((state) => state.shellMode);
  const setShellMode = usePaseoGoSettingsStore((state) => state.setShellMode);
  const shellModeActive = shellMode ?? SHELL_MODE_ENV_DEFAULT;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
    >
      <Text style={styles.title}>{t("me.title")}</Text>

      <Text style={styles.sectionHeader}>{t("me.shellModeHeader")}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{t("me.shellMode")}</Text>
            <Text style={styles.muted}>
              {t("me.shellModeHint", { env: SHELL_MODE_ENV_DEFAULT ? "on" : "off" })}
            </Text>
          </View>
          <ThemedModeSwitch
            testID="shell-mode-switch"
            value={shellModeActive}
            onValueChange={setShellMode}
          />
        </View>
      </View>

      <Text style={styles.sectionHeader}>{t("me.aboutHeader")}</Text>
      <View style={styles.card}>
        <Text style={styles.rowTitle}>{t("me.shellVersion", { version: SHELL_VERSION })}</Text>
        <Text style={styles.muted}>{t("me.upstream", { ref: SHELL_UPSTREAM_REF })}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing[2],
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
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  rowBody: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
