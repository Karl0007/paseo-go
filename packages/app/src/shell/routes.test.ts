// C4 acceptance: shell route strings round-trip through the official parsers for
// hostile ids (spaces, slashes, drive paths, CJK, %-#-& in payloads). This is the
// guard for the "no hand-assembled strings" rule — the builders must stay the thin
// wrappers over host-routes they are, or these round-trips break.
import { describe, expect, it } from "vitest";
import {
  parseHostWorkspaceOpenIntentFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import { OFFICIAL } from "./routes";

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
