// 文件浏览屏 — real root-Stack instance (card C16): the session capsule's 查看
// 项目文件 pushes this route, so it lands ON TOP of the session screen and
// hardware/gesture back pops it right back there. The (shell) hidden-tab route
// cannot express that: its push resolves into the existing (shell) entry
// (navigate-reuse — C14 measured router.push and a targeted StackActions.push
// behaving identically). Header back mirrors the pop, with the C6 preview
// screen's canGoBack fallback for a deep-linked entry with nothing underneath.
import { useCallback } from "react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { SHELL } from "@/shell/routes";
import { FilesScreenBody } from "@/shell/components/files-screen-body";

export default function DetailFilesScreen() {
  const { serverId, workspaceId } = useLocalSearchParams<{
    serverId: string;
    workspaceId: string;
  }>();

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(SHELL.workspace as Href);
  }, []);

  return (
    <FilesScreenBody
      serverId={serverId ?? ""}
      workspaceId={workspaceId ?? ""}
      onBack={handleBack}
    />
  );
}
