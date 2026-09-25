// 主机分组头 (DESIGN §5, card C5): connection dot + host label + ⚙ pushing the
// official host settings route. Offline hosts grey the whole header and swap the
// gear row for a single-host retry, mirroring the 对话 tab's offline group header.
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { RefreshCw, Settings } from "lucide-react-native";
import { HostStatusDot } from "@/components/host-status-dot";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

export function WorkspaceHostHeader({
  serverId,
  label,
  isOnline,
  onOpenSettings,
  onRetry,
}: {
  serverId: string;
  label: string;
  isOnline: boolean;
  onOpenSettings: (serverId: string) => void;
  onRetry: (serverId: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const handleRetry = useCallback(() => onRetry(serverId), [onRetry, serverId]);
  const handleSettings = useCallback(() => onOpenSettings(serverId), [onOpenSettings, serverId]);
  return (
    <View
      style={[styles.header, !isOnline && styles.headerOffline]}
      testID={`shell-host-header-${serverId}`}
    >
      <HostStatusDot serverId={serverId} />
      <Text style={[styles.label, !isOnline && styles.labelOffline]} numberOfLines={1}>
        {label}
      </Text>
      {isOnline ? null : (
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.retry}
          testID={`shell-host-retry-${serverId}`}
        >
          <RefreshCw size={12} color={styles.retryText.color} />
          <Text style={styles.retryText}>{t("workspace.retry")}</Text>
        </Pressable>
      )}
      <Pressable
        onPress={handleSettings}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.gear}
        testID={`shell-host-settings-${serverId}`}
      >
        <Settings size={15} color={styles.gearIcon.color} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
  },
  headerOffline: {
    opacity: 0.55,
  },
  label: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  labelOffline: {
    color: theme.colors.foregroundExtraMuted,
  },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  retryText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accent,
  },
  gear: {
    marginLeft: "auto",
    padding: theme.spacing[1],
  },
  gearIcon: {
    color: theme.colors.foregroundMuted,
  },
}));
