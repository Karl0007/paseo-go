// All route strings the Paseo Go shell navigates with (DESIGN.md §2.3) — single
// source of truth. Shell screens push SHELL.* within their own group and OFFICIAL.*
// to reuse upstream routes unchanged (D2). `files`/`preview`/`commandRun` land in
// later cards (C5-C7); the strings are declared here so call sites never inline paths.
import type { Href } from "expo-router";
import {
  buildHostWorkspaceOpenRoute,
  buildHostWorkspaceRoute,
  buildSettingsAddHostRoute,
} from "@/utils/host-routes";

export const SHELL = {
  root: "/(shell)",
  chats: "/(shell)/chats",
  workspace: "/(shell)/workspace",
  me: "/(shell)/me",
  files: "/(shell)/files/[serverId]/[workspaceId]",
  preview: "/(shell)/preview",
  commandRun: "/(shell)/run",
} as const;

// Tab screen names for in-navigator jumps (navigation.navigate never pops the root
// stack, unlike a path navigate — the files placeholder's back must stay in-tabs).
export const SHELL_TAB = { chats: "chats", workspace: "workspace", me: "me" } as const;

// The files route is dynamic; push it through this param object so the segment
// names stay in one place and expo-router handles encoding (C5 rows → C6 browse).
export function shellFilesHref(serverId: string, workspaceId: string): Href {
  return { pathname: SHELL.files, params: { serverId, workspaceId } } as Href;
}

// Workspace routes wrap the official builders (host-routes) so the shell never
// hand-assembles segments: `agentOpen` is the C4 open-intent target (workspace
// route + `?open=agent:<id>`), the replacement for the old `/h/[sid]/agent/[aid]`
// parse-stub push that flashed a white frame on back (SPIKE A2).
export const OFFICIAL = {
  workspace: (serverId: string, workspaceId: string) =>
    buildHostWorkspaceRoute(serverId, workspaceId),
  agentOpen: (serverId: string, workspaceId: string, agentId: string) =>
    buildHostWorkspaceOpenRoute(serverId, workspaceId, `agent:${agentId}`),
  hostSettings: (serverId: string) => `/h/${serverId}/settings`,
  welcome: "/welcome",
  // 连接新主机: the official add-host intent (settings screen + AddHostMethodModal,
  // direct/SSH/pair-link). Works with hosts already present, unlike /welcome which
  // only offers the connect cards on first run.
  addHost: (intentId: number) => buildSettingsAddHostRoute(intentId),
} as const;
