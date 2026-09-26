// C30 root-level split host (DESIGN-tablet.md §3.2 T-A). Mounted once at the
// AppShell seam (`app/_layout.tsx`, +3 lines, single wrapper, zero logic):
// inactive = `children` verbatim, so the compact / shell-off / full-bleed tree
// is byte-identical to pre-C30 (§6); active = [ nav rail | list placeholder |
// children ], with children = the official AppContainer — the root Stack's only
// render area, so pushed session routes land in the detail column as real
// routes (§3.2, no embedding, no route changes).
import React, { type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TabletListColumn } from "./list-column";
import { TABLET_DETAIL_MIN_WIDTH } from "./metrics";
import { TabletNavRail } from "./nav-rail";
import { useTabletSplit } from "./use-tablet-split";

export default function ShellTabletSplitHost({ children }: { children: ReactNode }) {
  const split = useTabletSplit();
  if (!split.active) return children;
  return (
    <View style={styles.row} testID="shell-tablet-split">
      <TabletNavRail section={split.section} />
      <TabletListColumn section={split.section} />
      <View style={styles.detail}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors.surface0,
  },
  detail: {
    flex: 1,
    // §4-5 floor; the §2 width table guarantees it at every active breakpoint
    // (md 720−56−260=404, lg 1024−64−300=660) — pinned so a future width edit
    // that breaks the math fails visibly instead of squashing the session.
    minWidth: TABLET_DETAIL_MIN_WIDTH,
  },
}));
