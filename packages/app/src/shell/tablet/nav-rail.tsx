// C30 nav rail (DESIGN-tablet.md §3.2-1): the three shell destinations on wide
// screens, replacing the bottom tab bar. Same routes (SHELL.*), same lucide
// glyphs as the (shell) tab icons ((shell)/_layout.tsx:41-51) and same `tabs.*`
// copy — zero new i18n keys. Press = expo `navigate` to the tab: for an already
// mounted tab that switches and pops whatever was pushed above it (§4-3), which
// is exactly the rail semantics. Re-press on the live section also fires the
// rail-retap event (§4-8; scrollToTop subscribes in C31).
// `import React` (not just the hooks): vitest compiles JSX with the classic
// runtime (expo tsconfig `jsx: react-native`), so a source file mounted by a
// component test must keep React in scope — the import-session-sheet pattern.
import React, { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { FolderTree, MessageCircle, User } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL } from "@/shell/routes";
import { useTabletColumns } from "./form-factor";
import { emitRailRetap } from "./rail-events";
import type { TabletSection } from "./split-predicates";

export interface TabletSectionMeta {
  section: TabletSection;
  labelKey: "tabs.chats" | "tabs.workspace" | "tabs.me";
  href: (typeof SHELL)[TabletSection];
  Icon: typeof MessageCircle;
}

export const TABLET_SECTION_META: Record<TabletSection, TabletSectionMeta> = {
  chats: { section: "chats", labelKey: "tabs.chats", href: SHELL.chats, Icon: MessageCircle },
  workspace: {
    section: "workspace",
    labelKey: "tabs.workspace",
    href: SHELL.workspace,
    Icon: FolderTree,
  },
  me: { section: "me", labelKey: "tabs.me", href: SHELL.me, Icon: User },
};

// Rail order = tab order in (shell)/_layout.
export const TABLET_SECTIONS: readonly TabletSectionMeta[] = [
  TABLET_SECTION_META.chats,
  TABLET_SECTION_META.workspace,
  TABLET_SECTION_META.me,
];

// One destination. The row binds its own press and memoizes its press props —
// the FilterSegment/chat-list-row posture react-perf demands.
function RailItemButton({
  meta,
  label,
  selected,
}: {
  meta: TabletSectionMeta;
  label: string;
  selected: boolean;
}) {
  const onPress = useCallback(() => {
    if (selected) emitRailRetap(meta.section);
    router.navigate(meta.href);
  }, [selected, meta]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const itemStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.item, pressed && styles.itemPressed],
    [],
  );
  // Render-time reads of the style proxies (schedule-row glyph idiom) — never
  // hoisted, so a persisted dark theme can't catch a stale light colour.
  const tint = selected ? styles.iconActive.color : styles.iconInactive.color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={itemStyle}
      testID={`shell-tablet-rail-${meta.section}`}
    >
      <meta.Icon size={22} color={tint} />
      <Text
        style={[styles.label, selected ? styles.labelActive : styles.labelInactive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function TabletNavRail({ section }: { section: TabletSection }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  // C31-F1: width from the window-dimension source shared with split activation
  // (breakpoint-keyed style values would ride the stale Unistyles breakpoint).
  const { rail } = useTabletColumns();
  return (
    <View style={[styles.rail, { width: rail }]} testID="shell-tablet-rail">
      {TABLET_SECTIONS.map((item) => (
        <RailItemButton
          key={item.section}
          meta={item}
          label={t(item.labelKey)}
          selected={item.section === section}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    flexShrink: 0,
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  item: {
    width: 44,
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  itemPressed: {
    backgroundColor: theme.colors.surface1,
  },
  // Colour holders for the lucide glyphs (the schedule-row glyph idiom).
  iconActive: {
    color: theme.colors.accent,
  },
  iconInactive: {
    color: theme.colors.foregroundMuted,
  },
  label: {
    fontSize: theme.fontSize.sm,
  },
  labelActive: {
    color: theme.colors.accent,
  },
  labelInactive: {
    color: theme.colors.foregroundMuted,
  },
}));
