// C4: the official navigateToAgent tool family (resolveNavigateToAgent → workspace
// route + open intent, the SPIKE A2 sanctioned path) with exactly one deviation: the
// navigation verb is `router.push`, never `router.navigate`/`dismissTo`. Real device
// (C4): the official `navigateToHostWorkspaceRoute` verb is `router.dismissTo`, which
// POPS the chats screen on entry — the system back button then exits the app instead
// of returning to the list. Pushing keeps the list mounted under the session screen:
// back pops to it (no parse-stub frame is ever mounted), and the pure official
// resolution logic (workspace identity, open-intent tab reveal, cold deep-link
// fallback) is reused verbatim from upstream modules.
import { router, type Href } from "expo-router";
import {
  navigateToWorkspace as navigateToWorkspacePure,
  type NavigateToWorkspaceDeps,
} from "@/stores/navigation-active-workspace-store/navigation";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { resolveNavigateToAgent } from "@/utils/navigate-to-agent/resolve";

function pushRoute(route: string): void {
  router.push(route as Href);
}

function workspaceDeps(): NavigateToWorkspaceDeps {
  return {
    getSessionWorkspaces: (serverId) => useSessionStore.getState().sessions[serverId]?.workspaces,
    getSessionAgents: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.agents.values() ?? [],
    isWorkspaceLayoutHydrated: () => useWorkspaceLayoutStore.persist.hasHydrated(),
    openTab: (input) => useWorkspaceLayoutStore.getState().openTab(input),
    // The workspace route's useActiveWorkspaceSelection remembers the selection on
    // mount (the official store's remember() is module-private); no-op keeps a
    // single writer and matches what the route does seconds later anyway.
    rememberLastWorkspace: () => {},
    navigateToRoute: pushRoute,
  };
}

export function shellNavigateToAgent(input: {
  serverId: string;
  agentId: string;
  workspaceId?: string | null;
}): void {
  resolveNavigateToAgent(input, {
    readAgentNavTarget: ({ serverId, agentId }) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      return { agentWorkspaceId: agent?.workspaceId };
    },
    navigateToHostAgent: pushRoute,
    navigateToWorkspace: (wsInput) => navigateToWorkspacePure(wsInput, workspaceDeps()),
  });
}
