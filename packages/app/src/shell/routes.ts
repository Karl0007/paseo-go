// All route strings the Paseo Go shell navigates with (DESIGN.md §2.3) — single
// source of truth. Shell screens push SHELL.* within their own group and OFFICIAL.*
// to reuse upstream routes unchanged (D2). `commandsEdit` lands with C7 (the run
// flow is a sheet on the 工作区 tab, not a route); DETAIL.* is the C6 preview stack
// plus the C16 files instance (real root-Stack push for the session capsule).
//
// R2-12: the group/segment NAMES below are what EVERY route-name comparison in the
// shell consumes (session-header capsule predicate, tablet selection, split
// predicates, focused-tab drill-down), and the SHELL.*/DETAIL.* paths are built
// FROM them — a rename can only ever happen here. routes.test.ts pairs the whole
// set against the real src/app file tree, so a drifted name fails the suite
// instead of silently killing navigation (capsule never shows, tab jumps miss).
import type { Href } from "expo-router";
import {
  buildHostWorkspaceOpenRoute,
  buildHostWorkspaceRoute,
  buildSettingsAddHostRoute,
} from "@/utils/host-routes";

/** Root-stack group names (expo-router directory names, no leading slash). */
export const SHELL_ROOT_ROUTE = "(shell)";
export const DETAIL_ROOT_ROUTE = "(detail)";
/** Official host navigator route (directory `src/app/h/[serverId]`). */
export const HOST_ROOT_ROUTE = "h/[serverId]";
/** Segment of the official workspace-session route under the host navigator. */
export const HOST_WORKSPACE_SEGMENT = "workspace";
/** Files browse screen's segment inside both groups (group-stripped: `/files/…`). */
export const FILES_ROUTE_SEGMENT = "files";

// Tab screen names for in-navigator jumps (navigation.navigate never pops the root
// stack, unlike a path navigate — the files placeholder's back must stay in-tabs).
// Also the source for the tab pathnames below and the rail's section keys.
export const SHELL_TAB = { chats: "chats", workspace: "workspace", me: "me" } as const;

export const SHELL = {
  root: `/${SHELL_ROOT_ROUTE}`,
  chats: `/${SHELL_ROOT_ROUTE}/${SHELL_TAB.chats}`,
  workspace: `/${SHELL_ROOT_ROUTE}/${SHELL_TAB.workspace}`,
  me: `/${SHELL_ROOT_ROUTE}/${SHELL_TAB.me}`,
  files: `/${SHELL_ROOT_ROUTE}/${FILES_ROUTE_SEGMENT}/[serverId]/[workspaceId]`,
  commandsEdit: `/${SHELL_ROOT_ROUTE}/commands/edit`,
  // C10 导入屏: 隐藏 tab（同 files/commands 的 C5 KI-2 模式），＋菜单 push 进入。
  import: `/${SHELL_ROOT_ROUTE}/import`,
  // C33 重命名屏: 隐藏 tab（同 files/commands/import 模式），行长按菜单与胶囊 ⋯ 的
  // rename 项 push 进入；菜单本体因此去掉了输入子页、转回 popover（DESIGN §14.3/§14.4）。
  rename: `/${SHELL_ROOT_ROUTE}/rename`,
} as const;

// 预览屏 lives in its own top-level group so opening a file is a real root-Stack
// push (C6 ruling): hardware/gesture back pops it naturally onto the files tab,
// unlike a hidden-tab screen whose back must be intercepted in-tab.
export const DETAIL = {
  preview: `/${DETAIL_ROOT_ROUTE}/preview`,
  files: `/${DETAIL_ROOT_ROUTE}/${FILES_ROUTE_SEGMENT}/[serverId]/[workspaceId]`,
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

// C33 重命名屏: the target rides the object params (serverId/agentId can carry `/`
// and `:` — expo-router owns the encoding, routes.test pins the round-trip); the
// screen rebuilds the pins-store key `${serverId}:${agentId}` from them.
export interface ShellRenameParams {
  serverId: string;
  agentId: string;
}

export function shellRenameHref(params: ShellRenameParams): Href {
  return { pathname: SHELL.rename, params: { ...params } } as Href;
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
  // 配对扫码 (split-predicates 的 full-bleed 面之一；R2-12 收进单源).
  pairScan: "/pair-scan",
  // C17 新建对话: the official New Workspace screen (app/new.tsx → NewWorkspaceScreen,
  // 项目/主机/Chat 三选择器 + composer). Object form by ruling — real host ids carry
  // `/` and `:` (`.dev/paseo-home@192.168.31.190:6767`), so expo-router owns the query
  // encoding instead of a hand-assembled `?serverId=` string (routes.test pins it).
  newWorkspace: (serverId: string): Href => ({ pathname: "/new", params: { serverId } }) as Href,
  // 连接新主机: the official add-host intent (settings screen + AddHostMethodModal,
  // direct/SSH/pair-link). Works with hosts already present, unlike /welcome which
  // only offers the connect cards on first run.
  addHost: (intentId: number) => buildSettingsAddHostRoute(intentId),
} as const;
