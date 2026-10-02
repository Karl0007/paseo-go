// B8-SWIPE (F27) — the full-width 堆叠页返回 overlay, mounted by `(detail)/_layout`
// next to the Stack. Topology is the C21 capsule's proven posture (its comment at
// shell-session-header.tsx:39 is the measured lesson): the layer registers against
// the official `content-floating-panels` Portal host — a plain layout sibling of
// the Stack renders UNDER native-stack's RNSScreen and receives nothing (measured
// this card, 2026-10-02) — and it is a `box-none` full-screen layer, never a band
// View: RN hit-test skips it, touches keep landing on the screen below, and RNGH
// still arbitrates the stream for the Pan.
//
// Two gates keep it out of other surfaces' business:
//   frontmost — the group layout stays mounted while an OFFICIAL screen is pushed
//     on top of a detail screen, so the Pan enables only while the root stack's
//     focused entry IS the (detail) group (otherwise it would race the capsule's
//     edge band on the session screen);
//   blocked — the screen-declared exemptions (搜索态/sheet) via stack-back-gate.
// The back verb is `detailBack`: pop onto whatever opened the screen, replace onto
// (shell)/chats on a headless deep-link stack (KI-17③ idiom, one source).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { Portal } from "@gorhom/portal";
import { DEFAULT_FLOATING_PANEL_PORTAL_HOST } from "@/components/ui/floating-panel-portal";
import { useRootNavigation } from "expo-router";
import { detailBack } from "@/shell/detail-back";
import { SHELL } from "@/shell/routes";
import type { BackPriorityStateLike } from "@/shell/search/shell-back-priority";
import { isDetailGroupFrontmost } from "./swipe-machine";
import { isStackBackBlocked, subscribeStackBackBlocked } from "./stack-back-gate";
import { useShellStackBackGesture } from "./use-shell-stack-back";

export function ShellStackBackOverlay() {
  const navigation = useRootNavigation();
  const [frontmost, setFrontmost] = useState(false);
  const blocked = useSyncExternalStore(subscribeStackBackBlocked, isStackBackBlocked);

  useEffect(() => {
    const record = () => {
      // The app Stack = the __root route's nested state (search-back-priority
      // reads it the same way). No state yet → not frontmost, fail closed.
      const appStack = navigation?.getState()?.routes[0]?.state as
        | BackPriorityStateLike
        | undefined;
      setFrontmost(isDetailGroupFrontmost(appStack));
    };
    record();
    return navigation?.addListener("state", record);
  }, [navigation]);

  const onBack = useCallback(() => detailBack(SHELL.chats), []);
  const gesture = useShellStackBackGesture({ enabled: frontmost, blocked, onBack });

  // 不在 (detail) 栈顶时整层卸载：Pan 不参与任何别的表面的仲裁。
  if (!frontmost) return null;
  return (
    <Portal hostName={DEFAULT_FLOATING_PANEL_PORTAL_HOST} name="shell-stack-back">
      <GestureDetector gesture={gesture}>
        <View pointerEvents="box-none" style={styles.layer} testID="shell-stack-back-layer" />
      </GestureDetector>
    </Portal>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
