// C27 页签/搜索纯逻辑契约: 默认文件段、非法值回退、非 git 置灰/回退、搜索范围
// 只圈本工作区。These are the guards the screen body leans on for 段切换往返状态
// 不串 + 非 git 目录置灰; the React side only wires them up.
import { describe, expect, it } from "vitest";
import type { FileSearchEntry } from "@/shell/search/file-search";
import {
  buildWorkspaceFileSearchSource,
  constrainFilesScreenTab,
  FILES_SCREEN_TABS,
  gitTabsDisabled,
  resolveFilesScreenTab,
} from "./files-tabs";

function file(name: string, path = name): FileSearchEntry {
  return { name, path, kind: "file" };
}

describe("resolveFilesScreenTab", () => {
  it("accepts exactly the three tab values", () => {
    // 钉死集合本身（R2-23）：回环遍历 FILES_SCREEN_TABS 再喂回 resolve 对
    // 「集合多了/少了哪个值」零敏感——标题里的 three 之前没有任何断言守着。
    expect([...FILES_SCREEN_TABS]).toEqual(["files", "diff", "git"]);
    expect(resolveFilesScreenTab("files")).toBe("files");
    expect(resolveFilesScreenTab("diff")).toBe("diff");
    expect(resolveFilesScreenTab("git")).toBe("git");
  });

  it("falls back to 文件 for unknown/absent values", () => {
    expect(resolveFilesScreenTab(undefined)).toBe("files");
    expect(resolveFilesScreenTab(null)).toBe("files");
    expect(resolveFilesScreenTab("")).toBe("files");
    expect(resolveFilesScreenTab("changes")).toBe("files");
    expect(resolveFilesScreenTab("DIFF")).toBe("files");
    expect(resolveFilesScreenTab(42)).toBe("files");
  });
});

describe("gitTabsDisabled / constrainFilesScreenTab", () => {
  it("grays the git sections only for a KNOWN non-git checkout", () => {
    expect(gitTabsDisabled(false)).toBe(true);
    expect(gitTabsDisabled(true)).toBe(false);
    // status still loading → no graying (the panes carry their own loading idiom)
    expect(gitTabsDisabled(null)).toBe(false);
    expect(gitTabsDisabled(undefined)).toBe(false);
  });

  it("kicks an open git section back to 文件 when the checkout turns non-git", () => {
    expect(constrainFilesScreenTab("diff", false)).toBe("files");
    expect(constrainFilesScreenTab("git", false)).toBe("files");
    expect(constrainFilesScreenTab("files", false)).toBe("files");
  });

  it("keeps the user's selection while git is available or unknown", () => {
    expect(constrainFilesScreenTab("diff", true)).toBe("diff");
    expect(constrainFilesScreenTab("git", undefined)).toBe("git");
    expect(constrainFilesScreenTab("files", true)).toBe("files");
  });
});

describe("buildWorkspaceFileSearchSource", () => {
  const base = {
    serverId: "host-a",
    hostLabel: "工作站",
    workspaceId: "ws-1",
    workspaceName: "paseo-go",
    workspaceRoot: "C:/work/paseo-go",
  };

  it("merges every browsed directory of THIS workspace into one source", () => {
    const source = buildWorkspaceFileSearchSource({
      ...base,
      browsed: [
        { workspaceId: "ws-1", entries: [file("BUILD.md")] },
        { workspaceId: "ws-1", entries: [file("DESIGN.md", "paseo-go/DESIGN.md")] },
      ],
    });
    expect(source).not.toBeNull();
    expect([...source!.entries].map((entry) => entry.path)).toEqual([
      "BUILD.md",
      "paseo-go/DESIGN.md",
    ]);
    // the preview triple rides along
    expect(source).toMatchObject({
      serverId: "host-a",
      workspaceId: "ws-1",
      workspaceRoot: "C:/work/paseo-go",
    });
  });

  it("excludes other workspaces' browsed entries", () => {
    const source = buildWorkspaceFileSearchSource({
      ...base,
      browsed: [{ workspaceId: "ws-other", entries: [file("secrets.env")] }],
    });
    expect(source).toBeNull();
  });

  it("returns null when nothing has been browsed (empty state owns the scope note)", () => {
    expect(buildWorkspaceFileSearchSource({ ...base, browsed: [] })).toBeNull();
    expect(
      buildWorkspaceFileSearchSource({ ...base, browsed: [{ workspaceId: "ws-1", entries: [] }] }),
    ).toBeNull();
  });
});
