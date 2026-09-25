// 壳 group 分发器 (card C8): the seam (src/app/index.tsx) redirects into the shell
// at the group root `/(shell)`; a bare group route is Unmatched at runtime (C1),
// and an explicit `/(shell)/chats` target would bypass the 默认启动 tab setting
// entirely. This index resolves the entry tab and redirects: the remembered focus
// (shellLastFocusedTab — the route the navigator restores to when the root stack's
// AppearanceStyleBoundary remounts it on a theme change) wins; a cold start falls
// back to 默认启动 tab.
import { Redirect, type Href } from "expo-router";
import { SHELL } from "@/shell/routes";
import { usePaseoGoSettingsStore, type ShellTab } from "@/shell/stores/settings";
import { shellLastFocusedTab } from "./_layout";

const TAB_HREF: Record<ShellTab, Href> = {
  chats: SHELL.chats as Href,
  workspace: SHELL.workspace as Href,
  me: SHELL.me as Href,
};

export default function ShellIndex() {
  const defaultTab = usePaseoGoSettingsStore((state) => state.defaultTab);
  return <Redirect href={TAB_HREF[shellLastFocusedTab() ?? defaultTab]} />;
}
