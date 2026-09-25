// All route strings the Paseo Go shell navigates with (DESIGN.md §2.3) — single
// source of truth. Shell screens push SHELL.* within their own group and OFFICIAL.*
// to reuse upstream routes unchanged (D2). `commandsEdit` lands with C7 (the run
// flow is a sheet on the 工作区 tab, not a route); DETAIL.* is the C6 preview stack
// plus the C16 files instance (real root-Stack push for the session capsule).
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
  commandsEdit: "/(shell)/commands/edit",
  // C10 导入屏: 隐藏 tab（同 files/commands 的 C5 KI-2 模式），＋菜单 push 进入。
  import: "/(shell)/import",
} as const;

// 预览屏 lives in its own top-level group so opening a file is a real root-Stack
// push (C6 ruling): hardware/gesture back pops it naturally onto the files tab,
// unlike a hidden-tab screen whose back must be intercepted in-tab.
export const DETAIL = {
  preview: "/(detail)/preview",
  files: "/(detail)/files/[serverId]/[workspaceId]",
} as const;

// Preview params ride the query string: paths carry CJK, spaces, '?' and '%', so
// they go through the object form and expo-router's own encoding — never a
// hand-assembled string (routes.test guards the round-trip).
export interface ShellPreviewParams {
  serverId: string;
  workspaceId: string;
  /** Workspace-relative file path, as the explorer reports it. */
  path: string;
  name: string;
  workspaceRoot?: string;
}

export function shellPreviewHref(params: ShellPreviewParams): Href {
  return { pathname: DETAIL.preview, params: { ...params } } as Href;
}

// Tab screen names for in-navigator jumps (navigation.navigate never pops the root
// stack, unlike a path navigate — the files placeholder's back must stay in-tabs).
export const SHELL_TAB = { chats: "chats", workspace: "workspace", me: "me" } as const;

// The files route is dynamic; push it through this param object so the segment
// names stay in one place and expo-router handles encoding (C5 rows → C6 browse).
export function shellFilesHref(serverId: string, workspaceId: string): Href {
  return { pathname: SHELL.files, params: { serverId, workspaceId } } as Href;
}

// C16 胶囊入口: the SAME browse screen as SHELL.files, mounted as a real
// root-Stack push so back pops onto the session screen. Pushing SHELL.files from
// a session resolves into the existing (shell) entry (navigate-reuse, C14
// measured) and pops the session — never use it as a capsule target.
export function shellFilesDetailHref(serverId: string, workspaceId: string): Href {
  return { pathname: DETAIL.files, params: { serverId, workspaceId } } as Href;
}

// 快捷指令表单屏: same screen serves 新建 (no id) and 编辑 (?id=) — the id goes
// through the object form so expo-router owns the encoding, like the preview params.
export function shellCommandEditHref(id?: string): Href {
  return (id ? { pathname: SHELL.commandsEdit, params: { id } } : SHELL.commandsEdit) as Href;
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
  // 全局设置: the official root-stack settings screen (settings/index route).
  settings: "/settings",
  welcome: "/welcome",
  // 连接新主机: the official add-host intent (settings screen + AddHostMethodModal,
  // direct/SSH/pair-link). Works with hosts already present, unlike /welcome which
  // only offers the connect cards on first run.
  addHost: (intentId: number) => buildSettingsAddHostRoute(intentId),
} as const;
