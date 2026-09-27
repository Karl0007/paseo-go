// C31 list column: the active section's REAL list bodies, double-instance (C16
// files-screen-body pattern) — while the split is active the tab screens render the
// detail placeholder instead (DESIGN-tablet §3.2 「活动 section 列表本体」).
//
// Keep-alive ruling (card 裁定 5 「body 不重挂为佳」): a section's body mounts on its
// first visit and NEVER unmounts after — inactive panes hide behind `opacity: 0` with
// `pointerEvents: "none"`, laid out as absolutely-positioned overlays of the column.
// That is what preserves list scroll position across rail tab round-trips: the views
// stay attached AND stay laid out, so the FlatList's native contentOffset survives
// (C31 device finding: `display: "none"` = View.GONE resets the Android ScrollView
// offset — scrolling survives a push/back round trip but not a section switch).
// Visited-mounting mirrors the Tabs semantics the compact shell already has (visited
// tabs stay mounted), so no section costs memory before it is ever opened; the cost
// of the overlay is that hidden panes keep laying out (three lists at once).
//
// C30 微调 (reported): the column's own section-title header is GONE — every body
// carries its own header (ChatsHeader / 工作区·我的 titles), and keeping the column
// title would double-render 「工作区」/「我的」 in wide, while bodies must stay
// byte-identical to compact (§6). Geometry (widths, border) and the column testID
// stay; the C30 placeholder moved to detail-placeholder.tsx (right column).
//
// Selection (DESIGN-tablet §3.2 「选中态单一真相」): the route-derived agent key is
// computed ONCE here and fed to the chats/workspace bodies — rows and rail share the
// same pathname-derived truth, no selection store.
import React, { useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChatsScreenBody } from "@/shell/components/chats-screen-body";
import { MeScreenBody } from "@/shell/components/me-screen-body";
import { WorkspaceScreenBody } from "@/shell/components/workspace-screen-body";
import { useTabletColumns } from "./form-factor";
import { TABLET_SECTIONS } from "./nav-rail";
import type { TabletSection } from "./split-predicates";
import { useTabletSelectedAgentKey } from "./use-tablet-selection";

export function TabletListColumn({ section }: { section: TabletSection }) {
  const selectedAgentKey = useTabletSelectedAgentKey();
  // C31-F1: same window-dimension source as split activation — the column flips
  // its 260/300 pair in the same frame the split activates (no stale breakpoint).
  const { list } = useTabletColumns();
  // Keep-alive: 首访挂载，此后只遮挡不卸载 (see header note).
  const [visited, setVisited] = useState<readonly TabletSection[]>(() => [section]);
  if (!visited.includes(section)) {
    // Render-phase state adjustment (React's sanctioned derive-from-props idiom) —
    // no effect round-trip, so a rail tap mounts the body in the SAME commit.
    setVisited((prev) => (prev.includes(section) ? prev : [...prev, section]));
  }
  return (
    <View style={[styles.column, { width: list }]} testID="shell-tablet-list-column">
      {TABLET_SECTIONS.map((meta) => {
        if (!visited.includes(meta.section)) return null;
        const active = meta.section === section;
        return (
          <View
            key={meta.section}
            // Hidden panes must not eat touches (they sit under the active one).
            pointerEvents={active ? "auto" : "none"}
            style={[styles.pane, active ? styles.paneActive : styles.paneHidden]}
          >
            {renderSectionBody(meta.section, selectedAgentKey)}
          </View>
        );
      })}
    </View>
  );
}

function renderSectionBody(section: TabletSection, selectedAgentKey: string | null) {
  if (section === "chats") return <ChatsScreenBody selectedAgentKey={selectedAgentKey} />;
  if (section === "workspace") return <WorkspaceScreenBody selectedAgentKey={selectedAgentKey} />;
  return <MeScreenBody />;
}

const styles = StyleSheet.create((theme) => ({
  column: {
    // §4 widths come from `useTabletColumns` (window dimensions, C31-F1).
    flexShrink: 0,
    backgroundColor: theme.colors.surface0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  // Overlay panes: all visited sections fill the column; the inactive ones are
  // transparent (never `display: "none"` — GONE resets list scroll offsets, see header).
  pane: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  paneActive: {
    opacity: 1,
  },
  paneHidden: {
    opacity: 0,
  },
}));
