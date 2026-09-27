// C31 reactive half of the selection state: pathname × the official live focus →
// the highlighted row key (the judgement itself is tablet-selection.ts, pure and
// unit-tested). Consumed ONLY by the split list column — compact never renders it
// (§6 「选中态/轨派器 仅左栏消费」). Zustand selector + container-level usePathname,
// no version-counter recomputes (§6 R-1).
import { usePathname } from "expo-router";
import { useSessionStore } from "@/stores/session-store";
import { sessionServerIdForPathname, tabletSelectedAgentKey } from "./tablet-selection";

export function useTabletSelectedAgentKey(): string | null {
  const pathname = usePathname();
  const serverId = sessionServerIdForPathname(pathname);
  const focusedAgentId = useSessionStore((state) =>
    serverId === null ? null : (state.sessions[serverId]?.focusedAgentId ?? null),
  );
  return tabletSelectedAgentKey(pathname, focusedAgentId);
}
