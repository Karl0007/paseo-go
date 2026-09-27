import { describe, expect, it } from "vitest";
import { requireWorkspaceDirectory, resolveWorkspaceDirectory } from "./workspace-directory";

describe("resolveWorkspaceDirectory", () => {
  it("canonicalizes a workspace directory and returns null when blank", () => {
    // R2-09: a definite Windows shape folds its drive-letter locator (identity
    // parity with the server's path comparison); the rest of the path is kept.
    expect(resolveWorkspaceDirectory({ workspaceDirectory: "C:\\repo\\app\\" })).toBe(
      "c:/repo/app",
    );
    expect(resolveWorkspaceDirectory({ workspaceDirectory: "   " })).toBeNull();
  });
});

describe("requireWorkspaceDirectory", () => {
  it("returns the canonical directory when present", () => {
    expect(requireWorkspaceDirectory({ workspaceDirectory: "/repo/app/" })).toBe("/repo/app");
  });

  it("throws naming the workspace when the directory is missing", () => {
    expect(() =>
      requireWorkspaceDirectory({ workspaceId: "wks_1", workspaceDirectory: "  " }),
    ).toThrow("Workspace directory is missing for workspace wks_1");
  });
});
