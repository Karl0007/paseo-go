// 我的 tab 路由屏 (C31 thin shell, C16 body pattern): the whole UI lives in
// @/shell/components/me-screen-body. Compact renders the body verbatim (§6 竖屏零回退);
// when the tablet split is active the 概览/设置列表 is hosted in the split's left
// column and this screen becomes the right-column placeholder (DESIGN-tablet §3.2 —
// 官方设置/host 设置 push 天然落右栏). No focus beat here: the 我的 body has no opener.
import { memo } from "react";
import { MeScreenBody } from "@/shell/components/me-screen-body";
import { TabletDetailPlaceholder } from "@/shell/tablet/detail-placeholder";
import { useTabletSplit } from "@/shell/tablet/use-tablet-split";

// memo: the shell re-renders on every pathname change (split activation read); the
// body's props are constant here, so the compact tree keeps its pre-C31 cadence.
const MeBody = memo(MeScreenBody);

export default function ShellMeScreen() {
  const split = useTabletSplit();
  if (split.active) return <TabletDetailPlaceholder section="me" />;
  return <MeBody />;
}
