// C30 list column = placeholder (card scope): the active section's name as the
// column header plus the C12 empty-state shape (icon + one-line guidance). C31
// swaps the body for the real double-instance list (C16 files-screen-body
// pattern); the header, geometry and testID stay.
import React from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { TABLET_LIST_WIDTH } from "./metrics";
import { TABLET_SECTION_META } from "./nav-rail";
import type { TabletSection } from "./split-predicates";

export function TabletListColumn({ section }: { section: TabletSection }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const meta = TABLET_SECTION_META[section];
  return (
    <View style={styles.column} testID="shell-tablet-list-column">
      <Text style={styles.title}>{t(meta.labelKey)}</Text>
      <View style={styles.empty} testID="shell-tablet-list-placeholder">
        <meta.Icon size={28} color={styles.emptyIcon.color} />
        <Text style={styles.emptyHint}>{t("tablet.listPlaceholder")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    // §4: 260 at md, 300 at lg/xl (breakpoint values inherit upward).
    width: { md: TABLET_LIST_WIDTH.md, lg: TABLET_LIST_WIDTH.lg },
    flexShrink: 0,
    backgroundColor: theme.colors.surface0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  title: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
