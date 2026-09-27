// C31 acceptance 2: the selection matrix — tab × pathname × 无选中. Every shell tab
// and hidden push selects NOTHING even when a stale focus exists; only the session
// route selects, and only with the official live focus present.
import { describe, expect, it } from "vitest";
import { sessionServerIdForPathname, tabletSelectedAgentKey } from "./tablet-selection";

describe("sessionServerIdForPathname", () => {
  it.each([
    "/chats",
    "/workspace",
    "/me",
    "/files/host%3A1/w1",
    "/import",
    "/commands/edit",
    "/rename",
    "/welcome",
    "/pair-scan",
    "/new",
    "/settings",
    // Near-misses that must NOT select:
    "/h/host%3A1", // no workspace segment
    "/h/host%3A1/settings", // host settings push
    "/workspace", // the workspace TAB (the session route embeds it mid-path only)
    "/chats/h/x/workspace/y", // not anchored at the root
  ])("maps non-session route %s to null", (pathname) => {
    expect(sessionServerIdForPathname(pathname)).toBeNull();
  });

  it("extracts the decoded serverId from the session route", () => {
    expect(sessionServerIdForPathname("/h/plain/workspace/w2")).toBe("plain");
    // Hostile deep link (F6/F8): an invalid percent escape must not throw —
    // the raw segment passes through and can never match a real row key.
    expect(sessionServerIdForPathname("/h/%ZZ/workspace/w2")).toBe("%ZZ");
    expect(tabletSelectedAgentKey("/h/%ZZ/workspace/w2", "a1")).toBe("%ZZ:a1");
    // The C4 open intent may still ride the query when the route re-renders.
    expect(sessionServerIdForPathname("/h/host%3A1/workspace/w2?open=agent:a1")).toBe("host:1");
    expect(sessionServerIdForPathname("/h/plain/workspace/w2")).toBe("plain");
  });
});

describe("tabletSelectedAgentKey", () => {
  it.each(["/chats", "/workspace", "/me", "/files/host%3A1/w1", "/import", "/welcome"])(
    "tab/hidden route %s selects nothing even with a live focus",
    (pathname) => {
      expect(tabletSelectedAgentKey(pathname, "a1")).toBeNull();
    },
  );

  it("session route + live focus selects `${serverId}:${agentId}`", () => {
    expect(tabletSelectedAgentKey("/h/host%3A1/workspace/w2", "a1")).toBe("host:1:a1");
    expect(tabletSelectedAgentKey("/h/host%3A1/workspace/w2?open=agent:a1", "a1")).toBe(
      "host:1:a1",
    );
  });

  it("session route WITHOUT a live focus (未选中矩阵) selects nothing", () => {
    expect(tabletSelectedAgentKey("/h/host%3A1/workspace/w2", null)).toBeNull();
    expect(tabletSelectedAgentKey("/h/host%3A1/workspace/w2", undefined)).toBeNull();
    // The session screen clears its focus on blur — a popped route never lingers.
  });

  it("non-session routes never select regardless of focus", () => {
    expect(tabletSelectedAgentKey("/h/host%3A1/settings", "a1")).toBeNull();
  });
});
