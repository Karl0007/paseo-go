// 工作区 tab 路由屏 (C31 thin shell, C16 body pattern): the whole UI lives in
// @/shell/components/workspace-screen-body. Compact renders the body verbatim (§6
// 竖屏零回退); when the tablet split is active the tree is hosted in the split's left
// column and this screen becomes the right-column placeholder (DESIGN-tablet §3.2
// 占位屏, §4-9 — L2 pushes the files page into this column, L3 the session).
//
// Like the 对话 shell, the screen emits the section-focus beat on focus in BOTH
// branches so the body's C26 L3 markRead return-stamp (C18 双拍) reaches it in either
// position — the column lives outside every navigator.
import { memo, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { emitSectionFocus } from "@/shell/section-focus";
import { WorkspaceScreenBody } from "@/shell/components/workspace-screen-body";
import { TabletDetailPlaceholder } from "@/shell/tablet/detail-placeholder";
import { useTabletSplit } from "@/shell/tablet/use-tablet-split";

// memo: the shell re-renders on every pathname change (split activation read); the
// body's props are constant here, so the compact tree keeps its pre-C31 cadence.
const WorkspaceBody = memo(WorkspaceScreenBody);

export default function ShellWorkspaceScreen() {
  const split = useTabletSplit();
  useFocusEffect(
    useCallback(() => {
      emitSectionFocus("workspace");
      return undefined;
    }, []),
  );
  if (split.active) return <TabletDetailPlaceholder section="workspace" />;
  return <WorkspaceBody />;
}
