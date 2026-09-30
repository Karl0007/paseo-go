// 一次性升级提示条 (M4 slice 2): shown after the startup probe finds a newer fork
// release the user hasn't seen yet. 不弹窗 — a thin bar above the tab area; tap =
// open the release page (下载落点), ✕ = dismiss. Both mark the version seen in the
// persisted notice store, so the same version never re-arms (a newer one does).
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { openExternalUrl } from "@/utils/open-external-url";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import type { Theme } from "@/styles/theme";
import { usePaseoGoUpdateNoticeStore } from "@/shell/stores/updateNotice";
import { shouldShowBanner, useShellUpdateStore } from "@/shell/update/state";

const closeIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedCloseIcon = withUnistyles(X);

export function ShellUpdateBanner() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const phase = useShellUpdateStore((state) => state.phase);
  const latest = useShellUpdateStore((state) => state.latest);
  const url = useShellUpdateStore((state) => state.url);
  const seenVersion = usePaseoGoUpdateNoticeStore((state) => state.seenVersion);
  const markSeen = usePaseoGoUpdateNoticeStore((state) => state.markSeen);

  const visible = shouldShowBanner({ phase, latest, seenVersion });
  const handleOpen = useCallback(() => {
    if (!visible || latest === null || url === null) return;
    markSeen(latest);
    void openExternalUrl(url).catch(() => undefined);
  }, [visible, latest, url, markSeen]);
  const handleDismiss = useCallback(() => {
    if (visible && latest !== null) markSeen(latest);
  }, [visible, latest, markSeen]);

  // react-perf: stable style callbacks, not per-render closures (SettingRow pattern).
  const pressStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.press, pressed && styles.pressActive],
    [],
  );
  const closeStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.close, pressed && styles.pressActive],
    [],
  );
  if (!visible || latest === null) return null;
  return (
    <View style={styles.bar} testID="shell-update-banner">
      <Pressable onPress={handleOpen} accessibilityRole="button" style={pressStyle}>
        <Text style={styles.text} numberOfLines={2}>
          {t("update.banner", { version: latest })}
        </Text>
      </Pressable>
      <Pressable
        onPress={handleDismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("update.dismiss")}
        testID="shell-update-banner-dismiss"
        style={closeStyle}
      >
        <ThemedCloseIcon size={16} uniProps={closeIconColor} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  press: {
    flex: 1,
  },
  pressActive: {
    opacity: 0.7,
  },
  text: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  close: {
    padding: theme.spacing[1],
  },
}));
