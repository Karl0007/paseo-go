// All route strings the Paseo Go shell navigates with (DESIGN.md §2.3) — single
// source of truth. Shell screens push SHELL.* within their own group and OFFICIAL.*
// to reuse upstream routes unchanged (D2). `files`/`preview`/`commandRun` land in
// later cards (C5-C7); the strings are declared here so call sites never inline paths.

import { buildHostWorkspaceOpenRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";

export const SHELL = {
  root: "/(shell)",
  chats: "/(shell)/chats",
  workspace: "/(shell)/workspace",
  me: "/(shell)/me",
  files: "/(shell)/files/[serverId]/[workspaceId]",
  preview: "/(shell)/preview",
  commandRun: "/(shell)/run",
} as const;

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
  // Official first-run connect/pair flow — the empty-state CTA when no host exists.
  welcome: "/welcome",
} as const;
