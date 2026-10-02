// C30 root-level split host (DESIGN-tablet.md §3.2 T-A). Mounted once at the
// AppShell seam (`app/_layout.tsx`, +3 lines, single wrapper, zero logic):
// inactive = the official AppContainer alone (rail/list render as null), active
// = [ nav rail | list bodies | children ], with children = the official
// AppContainer — the root Stack's only render area, so pushed session routes
// land in the detail column as real routes (§3.2, no embedding, no route changes).
//
// C31-F1 (C32) structural contract: the wrapper chain is STABLE across the
// activation flip — children always sit at the same slot of the same element
// chain, so a rotation never unmounts/remounts the AppContainer subtree. The
// original conditional shape (`!active ? children : <View>…`) swapped the
// element type at that slot and React destroyed + rebuilt the whole official
// tree mid-rotation; with a session open that remount deterministically crashes
// react-native-gesture-handler 2.28 (device-proven redscreen "Unable to find
// node on an unmounted component": a mounting detector's layout-effect
// `attachHandlers → MountRegistry.gestureWillMount` cascades into a
// deleting-detector mount-listener whose `findNodeHandle` hits the removed
// host — RNGH's passive cleanup runs after the layout mount it races with).
// The stable shape also makes §2 "转屏不触导航栈" structurally true: navigator
// state, list scroll offsets and in-flight screens survive every rotation.
// Compact cost: three transparent flex:1 Views around the tree (no visual,
// gesture or layout delta — verified on-device, portrait screenshots unchanged;
// the third is the REVIEW-B8-14 edge-back host, itself part of the stable chain).
import React, { type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ShellRowMenuHost } from "@/shell/components/chat-row-menu";
import { ShellSessionEdgeBackHost } from "@/shell/gestures/shell-session-edge-back-host";
import { TabletListColumn } from "./list-column";
import { TABLET_DETAIL_MIN_WIDTH } from "./metrics";
import { TabletNavRail } from "./nav-rail";
import { useTabletSplit } from "./use-tablet-split";

export default function ShellTabletSplitHost({ children }: { children: ReactNode }) {
  const split = useTabletSplit();
  return (
    <View
      style={split.active ? styles.row : styles.passthrough}
      testID={split.active ? "shell-tablet-split" : undefined}
    >
      {split.active ? <TabletNavRail section={split.section} /> : null}
      {split.active ? <TabletListColumn section={split.section} /> : null}
      <View style={split.active ? styles.detail : styles.passthrough}>
        {/* REVIEW-B8-14: C21 左缘带兜底挂在会话屏的祖先面上（常挂载、跨翻转
            稳定；禁用态不接管触摸）。见该组件头注的真机拓扑裁定。 */}
        <ShellSessionEdgeBackHost>{children}</ShellSessionEdgeBackHost>
      </View>
      {/* KI-11 ruling ①: the chat-row menu's window-hosted surface (the engine
          Modal cannot open mid-gesture without killing the row's touch stream).
          Mounted here — above the rail, the list columns and the navigator —
          so its backdrop owns the whole window exactly like the Modal did.
          Always rendered (null while idle): the C31-F1 stable-chain contract. */}
      <ShellRowMenuHost />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors.surface0,
  },
  // Inactive stand-ins: fill exactly what the direct children filled before
  // (the seam was visually a no-op) — transparent, flex:1, no chrome.
  passthrough: {
    flex: 1,
  },
  detail: {
    flex: 1,
    // §4-5 floor; the §2 width table guarantees it at every active breakpoint
    // (md 720−56−260=404, lg 1024−64−300=660) — pinned so a future width edit
    // that breaks the math fails visibly instead of squashing the session.
    minWidth: TABLET_DETAIL_MIN_WIDTH,
  },
}));
