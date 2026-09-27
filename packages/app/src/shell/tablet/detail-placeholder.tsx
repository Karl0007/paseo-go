// C31 right-column placeholder (DESIGN-tablet §3.2 「占位屏」/§4-9): while the split
// is active the (shell) tab screens render THIS instead of their list body — the
// list lives in the split's left column, and the detail column waits with the C12
// empty-state shape (icon + one-line guidance), the WeChat "未选择聊天" idiom. The
// C30 list-column placeholder is retired into this component (the column now hosts
// the real bodies); the icon-circle geometry follows the shell empty states.
import React from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { TABLET_SECTION_META } from "./nav-rail";
import type { TabletSection } from "./split-predicates";

export function TabletDetailPlaceholder({ section }: { section: TabletSection }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const meta = TABLET_SECTION_META[section];
  return (
    <View style={styles.wrap} testID="shell-tablet-detail-placeholder">
      <View style={styles.iconWrap}>
        <meta.Icon size={28} color={styles.icon.color} />
      </View>
      <Text style={styles.hint}>{t(`tablet.detailPlaceholder.${section}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  iconWrap: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  icon: {
    color: theme.colors.foregroundExtraMuted,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
