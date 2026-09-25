// Chat list section header (DESIGN §4): plain caps group title for the three online
// groups; offline-host groups carry the host label plus a single-host retry button.
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react-native";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

export function ChatSectionHeader({
  title,
  onRetry,
  testID,
}: {
  title: string;
  onRetry?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.header} testID={testID}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.retry}
          testID={testID ? `${testID}-retry` : undefined}
        >
          <RefreshCw size={12} color={styles.retryText.color} />
          <Text style={styles.retryText}>{t("chats.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
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
}));
