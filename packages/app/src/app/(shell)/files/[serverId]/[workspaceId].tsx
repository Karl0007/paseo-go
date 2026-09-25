// 文件浏览屏 — hidden-tab instance (C5 KI-2 form, unchanged behavior; card C16
// extracted the UI into FilesScreenBody so the (detail) stack instance can share
// it). The screen rides the tabs route tree but is never a visible tab, so both
// back affordances jump through the tab navigator itself — it only switches tabs,
// never pops the root stack (a path navigate could pop unrelated root-stack
// screens, e.g. restored deep links). The Android hardware listener lives only
// while focused (official workspace-screen.tsx pattern). The 工作区 rows push
// this route via shellFilesHref; the session capsule pushes the (detail)
// instance instead (shellFilesDetailHref).
import { useCallback } from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { SHELL_TAB } from "@/shell/routes";
import { FilesScreenBody } from "@/shell/components/files-screen-body";

export default function ShellFilesScreen() {
  const navigation = useNavigation();
  const { serverId, workspaceId } = useLocalSearchParams<{
    serverId: string;
    workspaceId: string;
  }>();

  const handleBack = useCallback(
    () => navigation.navigate({ name: SHELL_TAB.workspace } as never),
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        navigation.navigate({ name: SHELL_TAB.workspace } as never);
        return true;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <FilesScreenBody
      serverId={serverId ?? ""}
      workspaceId={workspaceId ?? ""}
      onBack={handleBack}
    />
  );
}
