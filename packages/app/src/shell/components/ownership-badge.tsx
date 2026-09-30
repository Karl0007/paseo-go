// 「外部」 ownership badge (B4-OWNERSHIP-UI, batch-4 F8 ruling 14): one pill, two
// surfaces — the chat row's title line and the session header capsule. The rules
// live in shell/chats/ownership.ts; this is the renderer.
//
// Visual contract: a warning-tint pill with the statusWarning word — deliberately
// NOT the grey 已导入/已归档 birth pill (import screen) and NOT the four-state
// status light: ownership is its own axis (BATCH4-ALIGNMENT F8.6) and must not
// borrow either existing marker's color story. `外部` = the session last changed
// hands outside paseo; `外部·运行中` additionally says the external writer still
// looks alive (the R4 warning condition).
import { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { OWNERSHIP_BADGE_LABEL_KEY, ownershipBadgeKind } from "@/shell/chats/ownership";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

export const OwnershipBadge = memo(function OwnershipBadge({
  ownership,
  externalLooksActive,
  testID,
}: {
  /** Protocol `ownership`; `undefined`/`null` read as `none` (no badge). */
  ownership: string | null | undefined;
  /** Protocol `externalLooksActive`; `undefined`/`null` read as `false`. */
  externalLooksActive: boolean | null | undefined;
  testID?: string;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  // Flat primitive props: the row/capsule re-render on every directory tick and
  // this component is memo'd — an object prop would defeat that (and lint).
  const kind = ownershipBadgeKind({ ownership, externalLooksActive });
  if (kind === null) return null;
  return (
    <View style={styles.pill} testID={testID}>
      <Text style={styles.text}>{t(OWNERSHIP_BADGE_LABEL_KEY[kind])}</Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // Shrink-safe on the title line (the title flexes first, ruling 6's posture)
  // and quiet enough to keep the title the row's protagonist.
  pill: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusWarningTint,
  },
  text: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.statusWarning,
  },
}));
