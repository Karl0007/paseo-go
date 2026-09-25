// All route strings the Paseo Go shell navigates with (DESIGN.md §2.3) — single
// source of truth. Shell screens push SHELL.* within their own group and OFFICIAL.*
// to reuse upstream routes unchanged (D2). `files`/`preview`/`commandRun` land in
// later cards (C5-C7); the strings are declared here so call sites never inline paths.

export const SHELL = {
  root: "/(shell)",
  chats: "/(shell)/chats",
  workspace: "/(shell)/workspace",
  me: "/(shell)/me",
  files: "/(shell)/files/[serverId]/[workspaceId]",
  preview: "/(shell)/preview",
  commandRun: "/(shell)/run",
} as const;

export const OFFICIAL = {
  agent: (serverId: string, agentId: string) => `/h/${serverId}/agent/${agentId}`,
  hostSettings: (serverId: string) => `/h/${serverId}/settings`,
} as const;
