// B4-IMPORT（批次四 F7 裁定 12）：导入屏的 handle 索引数据源。
// 目录真相在 session-store 的 per-host agents Map（与 useAggregatedAgents 同一
// 订阅面），但聚合 hook 丢 persistence 且默认剔除归档体——徽标两态都要，
// 所以这里直读原始 Agent：persistence(sessionId/nativeHandle) 进索引，
// archived = 服务端 archivedAt ∪ 壳归档 store（对话 tab「已归档」段的成员集，
// 跳转落点与它一致）。
//
// 订阅姿势照抄 useAggregatedAgents：Map 可能被就地突变，useShallow 的引用比较
// 兜不住，真正的重算信号是 host-runtime 的 version（目录同步状态机每拍 +1）。
// demand 与 chats 屏同款：导入屏从对话 tab push 进来时目录本就有人点验；
// 深链直达时这里补一份，卸载即释放。
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import {
  buildImportAgentHandleIndex,
  type ImportAgentHandleFacts,
  type ImportAgentHandleSource,
} from "./rows";

const EMPTY_INDEX: ReadonlyMap<string, ImportAgentHandleFacts> = new Map();

export function useImportAgentHandleIndex(
  serverId: string | null,
): ReadonlyMap<string, ImportAgentHandleFacts> {
  const runtime = getHostRuntimeStore();
  useEffect(() => {
    if (!serverId) return undefined;
    const release = runtime.acquireDirectoryDemand(serverId);
    return () => release();
  }, [runtime, serverId]);
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const agents = useSessionStore(
    useShallow((state) => (serverId ? state.sessions[serverId]?.agents : undefined)),
  );
  const archivedIds = usePaseoGoArchiveStore((state) => state.archivedIds);

  return useMemo(() => {
    // runtimeVersion 是重算信号本身，不进输出。
    void runtimeVersion;
    if (!serverId || !agents || agents.size === 0) return EMPTY_INDEX;
    const shellArchived = new Set(archivedIds);
    const sources: ImportAgentHandleSource[] = [];
    for (const agent of agents.values()) {
      if (!agent.persistence) continue;
      sources.push({
        id: agent.id,
        provider: agent.provider,
        archived: Boolean(agent.archivedAt) || shellArchived.has(`${serverId}:${agent.id}`),
        persistence: agent.persistence,
      });
    }
    return buildImportAgentHandleIndex(sources);
  }, [agents, archivedIds, runtimeVersion, serverId]);
}
