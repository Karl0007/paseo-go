// 对话 tab 路由屏 (C31 thin shell, C16 body pattern): the whole UI lives in
// @/shell/components/chats-screen-body. Compact renders the body verbatim — the tree
// is what the screen always rendered (§6 竖屏零回退); when the tablet split is active
// the list is hosted in the split's left column and this screen becomes the
// right-column placeholder (DESIGN-tablet §3.2 占位屏, §4-9).
//
// The screen keeps emitting the section-focus beat on focus in BOTH branches: the
// body's C18 双拍 return-stamp rides the section bus (subscribeSectionFocus), which
// is the only channel that reaches the body in its wide position — outside every
// navigator, where useFocusEffect cannot be called.
import { memo, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ChatsScreenBody } from "@/shell/components/chats-screen-body";
import { emitSectionFocus } from "@/shell/section-focus";
import { TabletDetailPlaceholder } from "@/shell/tablet/detail-placeholder";
import { useTabletSplit } from "@/shell/tablet/use-tablet-split";

// memo: the shell subscribes to the pathname (split activation) and re-renders on
// every push/pop; the body's props are constant here, so the compact tree keeps its
// pre-C31 render cadence (§6 竖屏零回退).
const ChatsBody = memo(ChatsScreenBody);

export default function ShellChatsScreen() {
  const split = useTabletSplit();
  useFocusEffect(
    useCallback(() => {
      emitSectionFocus("chats");
      return undefined;
    }, []),
  );
  if (split.active) return <TabletDetailPlaceholder section="chats" />;
  return <ChatsBody />;
}
