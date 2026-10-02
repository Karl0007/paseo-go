// Four-state chat light (DESIGN §4, C1-spike A4): the official AgentStatusDot on top
// of the official sidebar bucket; the running bucket gets a low-power breathing loop
// (one shared value, opacity only, ~1s per half-cycle — the Reanimated pattern the
// volume meter uses). done renders as the inactive grey dot so the four states are
// always visible.
import { useEffect } from "react";
import { StyleSheet } from "react-native-unistyles";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { AgentStatusDot } from "@/components/agent-status-dot";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

const BREATH_HALF_MS = 1100;
const BREATH_FLOOR = 0.35;

export function ChatStatusLight({
  agent,
  bucket,
}: {
  agent: AggregatedAgent;
  bucket: SidebarStateBucket;
}) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (bucket !== "running") {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(BREATH_FLOOR, {
          duration: BREATH_HALF_MS,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(1, {
          duration: BREATH_HALF_MS,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
    return () => {
      opacity.value = 0;
    };
  }, [bucket, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.wrap, animatedStyle]}>
      <AgentStatusDot
        status={agent.status}
        requiresAttention={agent.requiresAttention}
        attentionReason={agent.attentionReason}
        pendingPermissionCount={agent.pendingPermissionCount}
        showInactive={bucket === "done"}
      />
    </Animated.View>
  );
}

// REVIEW-B9-03: the wrap's width is row chrome — the chat row's title-line width
// budget (chat-list-row.tsx TITLE_LINE_BUDGET_DP) imports this constant instead
// of re-typing 12, so a light edit moves the budget in the same commit.
export const STATUS_LIGHT_WIDTH_DP = 12;

const styles = StyleSheet.create(() => ({
  wrap: {
    width: STATUS_LIGHT_WIDTH_DP,
    alignItems: "center",
    justifyContent: "center",
  },
}));
