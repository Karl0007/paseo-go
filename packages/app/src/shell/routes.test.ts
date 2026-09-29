// C4 acceptance: shell route strings round-trip through the official parsers for
// hostile ids (spaces, slashes, drive paths, CJK, %-#-& in payloads). This is the
// guard for the "no hand-assembled strings" rule — the builders must stay the thin
// wrappers over host-routes they are, or these round-trips break.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseHostWorkspaceOpenIntentFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import {
  DETAIL,
  DETAIL_ROOT_ROUTE,
  HOST_ROOT_ROUTE,
  HOST_WORKSPACE_SEGMENT,
  OFFICIAL,
  SHELL,
  SHELL_ROOT_ROUTE,
  SHELL_TAB,
  shellFilesHref,
  shellPreviewHref,
  shellRenameHref,
} from "./routes";

describe("OFFICIAL.workspace", () => {
  it("keeps url-safe ids verbatim (no double encoding)", () => {
    expect(OFFICIAL.workspace("srv-1", "ws_1.2~3")).toBe("/h/srv-1/workspace/ws_1.2~3");
  });

  it("round-trips a serverId with reserved characters", () => {
    const serverId = "host 9:80/#%&";
    const route = OFFICIAL.workspace(serverId, "ws-1");
    expect(parseHostWorkspaceRouteFromPathname(route)).toEqual({
      serverId,
      workspaceId: "ws-1",
    });
  });

  it("round-trips opaque workspace ids that are not url-safe", () => {
    for (const workspaceId of ["项目/工作区", "C:\\Users\\me\\repo", "ws with space ? & = 中文"]) {
      const route = OFFICIAL.workspace("srv-1", workspaceId);
      expect(parseHostWorkspaceRouteFromPathname(route), workspaceId).toEqual({
        serverId: "srv-1",
        workspaceId,
      });
    }
  });
});

describe("OFFICIAL.agentOpen", () => {
  it("attaches a parseable agent open intent", () => {
    const route = OFFICIAL.agentOpen("srv-1", "ws-1", "agent-9");
    expect(route).toBe("/h/srv-1/workspace/ws-1?open=agent%3Aagent-9");
    expect(parseHostWorkspaceOpenIntentFromPathname(route)).toEqual({
      kind: "agent",
      agentId: "agent-9",
    });
  });

  it("round-trips agent ids with colons and reserved characters alongside the intent", () => {
    const serverId = "host:443 中文";
    const workspaceId = "C:/work/项目 dir";
    const agentId = "sub:agent #7?%&";
    const route = OFFICIAL.agentOpen(serverId, workspaceId, agentId);
    expect(parseHostWorkspaceRouteFromPathname(route)).toEqual({ serverId, workspaceId });
    expect(parseHostWorkspaceOpenIntentFromPathname(route)).toEqual({ kind: "agent", agentId });
  });
});

describe("OFFICIAL.newWorkspace", () => {
  // C17: ＋菜单 → 新建对话 lands on the official New Workspace screen. Object form by
  // ruling: the target is the ROOT route "/new" (not a shell group path), the param
  // name is exactly the one app/new.tsx reads, and expo-router owns the encoding —
  // a builder that pre-encoded would fail the raw-value assertions below.
  it("targets the official /new route with serverId as a raw param", () => {
    expect(OFFICIAL.newWorkspace("srv-1")).toEqual({
      pathname: "/new",
      params: { serverId: "srv-1" },
    });
  });

  it("passes host ids carrying reserved characters through untouched", () => {
    for (const serverId of [
      ".dev/paseo-home@192.168.31.190:6767",
      "host 9:80/#%&",
      "主机 dir 100%",
    ]) {
      expect(OFFICIAL.newWorkspace(serverId), serverId).toEqual({
        pathname: "/new",
        params: { serverId },
      });
    }
  });
});

describe("shellPreviewHref", () => {
  // The C6 preview carries raw workspace paths (CJK, spaces, ?, %, #) through the
  // query string. expo-router owns the encoding — a builder that pre-encodes here
  // would double-encode and the preview screen would read mangled paths.
  it("passes hostile paths through as raw params on the detail route", () => {
    const params = {
      serverId: "host 9:80/#%&",
      workspaceId: "ws 1",
      path: "docs/中文 100%?#a.md",
      name: "中文 100%?#a.md",
      workspaceRoot: "C:\\tmp\\c5-proj",
    };
    expect(shellPreviewHref(params)).toEqual({ pathname: DETAIL.preview, params });
  });
});

describe("shellFilesHref", () => {
  // KI-9: ONE files instance on the (detail) root stack (the (shell) hidden-tab
  // twin is gone) — 工作区 tree rows and the session capsule push the same route,
  // a real push whose back pops onto the opener. `tab` is the optional INITIAL
  // page tab (菜单收敛: 查看项目文件=files / 查看 diff=diff); omitted means the
  // builder adds no key at all (the screen's own default stays 文件, and the URL
  // never carries a tab the user did not pick).
  it("targets the (detail) files route — the group-stripped global pathname is unchanged", () => {
    expect(DETAIL.files).toBe("/(detail)/files/[serverId]/[workspaceId]");
    expect(DETAIL.files.split("/").filter((s) => !s.startsWith("("))).toContain("files");
    expect("files" in SHELL).toBe(false);
  });

  it("passes opaque ids through as raw params (expo-router owns the encoding)", () => {
    const serverId = "host 9:80/#%&";
    const workspaceId = "C:/work/项目 dir";
    expect(shellFilesHref(serverId, workspaceId)).toEqual({
      pathname: DETAIL.files,
      params: { serverId, workspaceId },
    });
  });

  it("carries the initial tab only when given", () => {
    expect(shellFilesHref("s1", "w1", "diff")).toEqual({
      pathname: DETAIL.files,
      params: { serverId: "s1", workspaceId: "w1", tab: "diff" },
    });
    expect(shellFilesHref("s1", "w1", "files")).toEqual({
      pathname: DETAIL.files,
      params: { serverId: "s1", workspaceId: "w1", tab: "files" },
    });
  });
});

describe("shellRenameHref", () => {
  // C33: rename moved out of the menu pages into its own screen; KI-9 lives it on
  // the (detail) root stack. The target goes through the object form (host ids
  // carry `/` and `:` in the live .dev setup); a builder that hand-assembled a
  // query string would fail below.
  it("targets the (detail) rename route with raw serverId/agentId params", () => {
    const serverId = ".dev/paseo-home@192.168.31.190:6767";
    const agentId = "agent 9/#%&中文";
    expect(shellRenameHref({ serverId, agentId })).toEqual({
      pathname: DETAIL.rename,
      params: { serverId, agentId },
    });
  });
});

// KI-9 migration invariant: the four screens changed GROUP, never global pathname
// (expo-router strips the `(detail)` prefix) — split-predicates / tablet-selection
// derive sections from those stripped strings, so each constant must keep its
// group-stripped tail exactly.
describe("KI-9 root-stack migration invariants", () => {
  it("keeps every migrated route's group-stripped pathname intact", () => {
    expect(DETAIL.import).toBe("/(detail)/import");
    expect(DETAIL.commandsEdit).toBe("/(detail)/commands/edit");
    expect(DETAIL.rename).toBe("/(detail)/rename");
    for (const [name, pathname] of Object.entries(DETAIL)) {
      if (name === "preview") continue;
      expect(pathname.startsWith(`/${DETAIL_ROOT_ROUTE}/`), name).toBe(true);
    }
  });

  it("leaves the (shell) group with only the tabs + root", () => {
    expect(Object.keys(SHELL).sort()).toEqual(["chats", "me", "root", "workspace"]);
  });
});

// R2-12 constants↔tree gate: expo-router resolves EVERY pathname from the file
// tree under src/app, so a renamed/deleted route file silently breaks navigation
// (capsule never shows, tab jumps miss, 新建对话 white-screens) with nothing red.
// This pairs each registered route with its real module/dir — and every
// shell-owned route module back to a registration. The route-name constants the
// other predicates consume (session-header, tablet-selection, split-predicates,
// focused-tab) are pinned here too, which is what lets visibility.test.ts feed
// the predicate REAL literal names instead of the constants under test (R2-23).
const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

function existsAsRoute(pathname: string): boolean {
  // Exact-case walk: a plain existsSync would pass `(shelL)` on case-insensitive
  // Windows filesystems, and expo-router matches route names case-sensitively.
  const segs = pathname.split("/").filter(Boolean);
  let cur = APP_DIR;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const entries = existsSync(cur) ? readdirSync(cur) : [];
    if (entries.includes(seg)) {
      cur = path.join(cur, seg); // dir segment (group / param dir / folder)
      continue;
    }
    // The leaf may be a route module file rather than a dir.
    return last && (entries.includes(`${seg}.tsx`) || entries.includes(`${seg}.ts`));
  }
  return true;
}

/** Route modules inside a group dir, as `/…`-pathnames without extensions. */
function listRouteModules(groupDir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(APP_DIR, groupDir), { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listRouteModules(path.join(groupDir, entry.name), rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel.replace(/\.[^.]+$/, ""));
  }
  return out;
}

describe("route-name single source ↔ src/app tree (R2-12)", () => {
  it("registers only routes that exist as real files/dirs", () => {
    for (const [name, pathname] of Object.entries({ ...SHELL, ...DETAIL })) {
      expect(existsAsRoute(pathname), `${name} → ${pathname}`).toBe(true);
    }
    for (const tab of Object.values(SHELL_TAB)) {
      expect(existsAsRoute(`/${SHELL_ROOT_ROUTE}/${tab}`), tab).toBe(true);
    }
    // The names the OTHER predicates compare against (visibility/tablet-selection).
    expect(existsAsRoute(`/${HOST_ROOT_ROUTE}`), HOST_ROOT_ROUTE).toBe(true);
    expect(existsAsRoute(`/${HOST_ROOT_ROUTE}/${HOST_WORKSPACE_SEGMENT}`)).toBe(true);
    for (const official of [OFFICIAL.settings, OFFICIAL.welcome, OFFICIAL.pairScan, "/new"]) {
      expect(existsAsRoute(official), official).toBe(true);
    }
  });

  it("every route module in the shell groups is registered", () => {
    const registered = new Set<string>([...Object.values(SHELL), ...Object.values(DETAIL)]);
    const unregistered: string[] = [];
    for (const group of [SHELL_ROOT_ROUTE, DETAIL_ROOT_ROUTE]) {
      for (const mod of listRouteModules(group, group)) {
        // _layout = navigator config; index = the group's own entry (redirect /
        // tabs) — neither is a push target carried by SHELL/DETAIL. *.test =
        // vitest module (the F14-tracked rename.test.ts), never a route screen.
        if (/(^|\/)(_layout|index)$/.test(mod) || mod.endsWith(".test")) continue;
        if (!registered.has(`/${mod}`)) unregistered.push(`/${mod}`);
      }
    }
    expect(unregistered).toEqual([]);
  });

  it("keeps the group constants embedded in the built paths", () => {
    expect(SHELL.root).toBe(`/${SHELL_ROOT_ROUTE}`);
    expect(DETAIL.preview).toBe(`/${DETAIL_ROOT_ROUTE}/preview`);
  });
});
