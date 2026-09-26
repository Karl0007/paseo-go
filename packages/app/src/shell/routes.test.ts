// C4 acceptance: shell route strings round-trip through the official parsers for
// hostile ids (spaces, slashes, drive paths, CJK, %-#-& in payloads). This is the
// guard for the "no hand-assembled strings" rule — the builders must stay the thin
// wrappers over host-routes they are, or these round-trips break.
import { describe, expect, it } from "vitest";
import {
  parseHostWorkspaceOpenIntentFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import {
  DETAIL,
  OFFICIAL,
  SHELL,
  shellFilesDetailHref,
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

describe("shellFilesDetailHref", () => {
  // C16: the capsule must push the (detail) files instance, not the (shell)
  // hidden-tab route — the two pathnames being distinct IS the fix (a push of a
  // route whose group entry is absent from the root stack is a real push; a
  // push resolving into the mounted (shell) entry is the C14 navigate-reuse).
  it("targets the (detail) files route, distinct from the (shell) one", () => {
    expect(DETAIL.files).toBe("/(detail)/files/[serverId]/[workspaceId]");
    expect(DETAIL.files).not.toBe(SHELL.files);
  });

  it("passes opaque ids through as raw params (expo-router owns the encoding)", () => {
    const serverId = "host 9:80/#%&";
    const workspaceId = "C:/work/项目 dir";
    expect(shellFilesDetailHref(serverId, workspaceId)).toEqual({
      pathname: DETAIL.files,
      params: { serverId, workspaceId },
    });
  });
});

describe("shellRenameHref", () => {
  // C33: rename moved out of the menu pages into a hidden-tab screen. The target
  // goes through the object form (host ids carry `/` and `:` in the live .dev
  // setup); a builder that hand-assembled a query string would fail below.
  it("targets the (shell) rename route with raw serverId/agentId params", () => {
    const serverId = ".dev/paseo-home@192.168.31.190:6767";
    const agentId = "agent 9/#%&中文";
    expect(shellRenameHref({ serverId, agentId })).toEqual({
      pathname: SHELL.rename,
      params: { serverId, agentId },
    });
  });
});
