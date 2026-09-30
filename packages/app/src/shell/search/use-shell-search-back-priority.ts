// B4-BACK (BATCH4-ALIGNMENT F9 / 裁定 15) — the unified search back priority:
// while a search surface is open, the Android hardware back exits THE SEARCH
// (清查询 + 收起搜索条, 回本屏普通态) instead of switching the page. Every shell
// search surface wires through here (对话 header / 工作区 / 文件屏 / 导入); the
// exit itself stays each surface's own close handler — the hook owns only the
// WHEN of the claim.
//
// Registration posture (chat-row-menu.tsx is the sibling precedent): subscribe
// on `active`, unsubscribe on close/unmount — RN's BackHandler dispatches
// newest-subscriber-first and stops at the first `true` (BackHandler.android.js
// iterates _backPressSubscriptions from the tail), so the LATER surface wins:
// the row menu subscribes when it opens (over any live search) → 菜单 > 搜索 >
// 页面 falls out of mount timing alone. That is also why the subscription
// lifetime is pinned to `active` ALONE: re-subscribing on any other re-render
// would re-order this listener behind a menu that opened earlier. `onExit` and
// the route identity ride refs, read at press time.
//
// The press-time frontmost check (shell-back-priority.ts) is the second gate:
// bottom-tabs keep visited tab bodies mounted and (detail) pushes stack over
// the tabs, so `active` alone would let a background search swallow the front
// screen's back. Not frontmost → return false → the press keeps travelling to
// the older subscribers / the default page back.
//
// Android only: iOS/iPad have no hardware back, and react-native-web's
// BackHandler logs an error the moment anything subscribes (back-press.ts §) —
// web keeps its Esc/取消 posture untouched.
import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import { useRootNavigation } from "expo-router";
import {
  ownsFrontmostRoute,
  type BackPriorityStateLike,
  type ShellRouteIdentity,
} from "./shell-back-priority";

/**
 * Claim the Android hardware back while `active` (a search is open) AND the
 * surface's own screen is the frontmost route; `onExit` runs at most once per
 * press and the press is consumed only then. Registering IS the priority;
 * unmounting (or closing the search) leaves it.
 */
export function useShellSearchBackPriority(
  active: boolean,
  onExit: () => void,
  frontmost: ShellRouteIdentity,
): void {
  // The container ref is a non-reactive read (store.navigationRef.current) —
  // no pathname subscription, so the bodies keep their memo render cadence
  // (§6 竖屏零回退: the tab screens own the pathname subscription, not them).
  const navigation = useRootNavigation();
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const frontmostRef = useRef(frontmost);
  frontmostRef.current = frontmost;

  useEffect(() => {
    if (Platform.OS !== "android" || !active) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // The app Stack = the __root route's nested state (shell-session-header
      // reads it the same way). No state yet → fail open, see shell-back-priority.
      const appStack = navigation?.getState()?.routes[0]?.state as
        | BackPriorityStateLike
        | undefined;
      if (!ownsFrontmostRoute(appStack, frontmostRef.current)) return false;
      onExitRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [active, navigation]);
}
