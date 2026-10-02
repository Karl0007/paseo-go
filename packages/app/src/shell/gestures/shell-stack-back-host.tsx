// B8-SWIPE (F27) — 堆叠页全宽右滑返回的宿主：(detail) 组布局的根 View 就是那个 Pan
// 的挂靠面。拓扑是量出来的，不是推的（批次八 review 卡 09 重拍，2026-10-02）：初版把
// 一层无子节点的 `box-none` 图层 Portal 进 `content-floating-panels`，真机上 Pan 一
// 次也没拿到触摸流——该层是导航器的「兄弟」，命中测试落在它下面的屏幕上，而那次触摸
// 的 handler 链里没有它（C21 胶囊浮在同一个 host 里能用，是因为它的 32dp 带是手指底下
// 一个真实的 view）。RNGH 会仲裁的姿势是滚动体的「祖先」——与 tab 环、官方 explorer
// 手势同一拓扑——所以 Pan 挂在组自己的根 View 上，栈页内的每一次触摸都经过它。
//
// 全宽 = 整个栈页（不再有 start-x 带），不是整个窗口：宽屏下 (detail) 组就是右栏，
// 左栏的环在「有栈页在前」时由 frontmost 总线让位（swipe-machine 的 stackInFront），
// 所以左栏上的右滑谁的都不是——与修复前的观测一致，只是少了一个假想的所有者。
//
// 两道门照旧：`enabled`＝根栈当前聚焦项就是 (detail) 组（组布局在官方会话屏盖上来
// 之后仍然挂载，此时 Pan 必须让位给胶囊的左缘带，见 visibility.ts 裁定 2）；
// `blocked`＝各屏自己声明的豁免（搜索态/打开的 sheet，stack-back-gate）；再加
// HorizontalScrollContext 的声明性豁免（diff 代码块滚离前缘后保住自己的右滑）。
// 返回动词是 `detailBack`：弹回打开它的屏幕，无底深链栈 replace 回 (shell)/chats（KI-17③ 同款）。
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useRootNavigation } from "expo-router";
import { detailBack } from "@/shell/detail-back";
import { SHELL } from "@/shell/routes";
import type { BackPriorityStateLike } from "@/shell/search/shell-back-priority";
import { isDetailGroupFrontmost } from "./swipe-machine";
import { isStackBackBlocked, subscribeStackBackBlocked } from "./stack-back-gate";
import { useShellStackBackGesture } from "./use-shell-stack-back";

export function ShellStackBackHost({ children }: { children: ReactNode }) {
  const navigation = useRootNavigation();
  const [frontmost, setFrontmost] = useState(false);
  const blocked = useSyncExternalStore(subscribeStackBackBlocked, isStackBackBlocked);

  useEffect(() => {
    // The app Stack = the __root route's nested state (search-back-priority
    // reads it the same way). No state yet → not frontmost, fail closed.
    const record = () => {
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

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.host} testID="shell-stack-back-host">
        {children}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // 与旧布局根同尺寸：flex:1 包住 Stack，不改任何一屏的测量。
  host: { flex: 1 },
});
