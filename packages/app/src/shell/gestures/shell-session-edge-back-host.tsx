// REVIEW-B8-14 — C21 左缘带兜底的宿主：官方会话屏（上游滚动体）的 32dp 左缘右滑
// 返回，从胶囊的 Portal 层迁到会话屏的【祖先】面上。拓扑是量出来的，不是推的
// （卡 09 同款裁定，卡 14 真机复量 2026-10-02）：初版把 Pan 挂在胶囊浮层的
// `box-none` 层上——该层是导航器的「兄弟」，层内唯一可命中的子节点只有顶部胶囊
// bar（32dp 带是 pointerEvents="none" 的 layout/testID 锚点，不可命中）。真机
// 裁定：自 bar 起滑 pop（bar 是手指底下的真实 view，命中它的触摸的祖先链里有这
// 层），自屏幕中段左缘起滑三组 y/时长全部无响应（那次触摸的 handler 链里没有
// 这层，RNGH 不会跨层仲裁）。兜底要覆盖它声称覆盖的场景，手势面就必须是滚动体
// 的祖先——与 tab 环、官方 explorer 手势、(detail) 栈返回同一拓扑。
//
// 挂载点 = ShellTabletSplitHost 的 detail 槽（壳自有、常挂载、跨转屏稳定链，
// C31-F1 契约不破坏；勿动上游会话屏文件本体，DESIGN §2）。
//
// 门 = `shouldEnableShellEdgeBack`（C32 裁定 2：compact-only；wide 的 pop 由
// 硬件返回与胶囊 返回 key 承担——窗左缘在 wide 下压着列表列）。输入与胶囊共用
// 同一个 hook（visibility-input），二者对「胶囊是否在上」永不 disagreement。
// 官方左开/右开手势仍由胶囊的 symbol-keyed blocker 停放（胶囊在期 = 兜底在期）。
//
// Pan 的语义（32dp start-x 门、方向锁、detailBack 动词、横向滚动豁免）全部在
// `use-shell-edge-back-gesture`，未变；变的是挂靠面。禁用态（非会话屏/wide/
// overlay 开）handler 不接管任何触摸，其余屏幕零影响。
import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useShellEdgeBackGesture } from "@/shell/session-header/use-shell-edge-back-gesture";
import { shouldEnableShellEdgeBack } from "@/shell/session-header/visibility";
import { useShellSessionVisibilityInput } from "@/shell/session-header/visibility-input";

export function ShellSessionEdgeBackHost({ children }: { children: ReactNode }) {
  const visibilityInput = useShellSessionVisibilityInput();
  const enabled = useMemo(() => shouldEnableShellEdgeBack(visibilityInput), [visibilityInput]);
  const gesture = useShellEdgeBackGesture(enabled);

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={styles.host} testID="shell-session-edge-back-host">
        {children}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // 与 detail 槽原尺寸同形：flex:1 包住 children，不改任何一屏的测量。
  host: { flex: 1 },
});
