// 文件浏览屏 — the ONE root-stack instance (card C16 opened it as the capsule's
// real-push entry; KI-9 retired the (shell) hidden-tab twin and merged the entry
// points through shellFilesHref). Lands ON TOP of whatever opened it — 工作区 tree
// row, session capsule, deep link — so hardware/gesture back pops right back
// there; the header back mirrors the pop via detailBack (canGoBack兑底 = 工作区).
// KI-9 菜单收敛: the optional `tab` query param picks the INITIAL page tab
// (查看项目文件=files / 查看 diff=diff); anything unknown resolves to 文件
// (resolveFilesScreenTab) and the value is consumed once into in-screen state —
// C27 裁定 4 keeps it out of persist and out of later URL state.
import { useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { SHELL } from "@/shell/routes";
import { detailBack } from "@/shell/detail-back";
import { resolveFilesScreenTab } from "@/shell/files/files-tabs";
import { FilesScreenBody } from "@/shell/components/files-screen-body";

export default function DetailFilesScreen() {
  const { serverId, workspaceId, tab } = useLocalSearchParams<{
    serverId: string;
    workspaceId: string;
    tab?: string;
  }>();

  const handleBack = useCallback(() => detailBack(SHELL.workspace), []);

  return (
    <FilesScreenBody
      serverId={serverId ?? ""}
      workspaceId={workspaceId ?? ""}
      initialTab={resolveFilesScreenTab(tab)}
      onBack={handleBack}
    />
  );
}
