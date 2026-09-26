// C9 acceptance: 文件名搜索纯函数单测 — 大小写 / CJK / 空串 / 目录不命中 /
// 跨 host 去重排序 / 上限截断。
import { afterEach, describe, expect, it } from "vitest";
import { buildWorkspaceExplorerStateKey } from "@/file-explorer/state-keys";
import {
  useSessionStore,
  type AgentFileExplorerState,
  type ExplorerEntry,
} from "@/stores/session-store";
import {
  collectBrowsedWorkspaces,
  searchFileNames,
  FILE_SEARCH_LIMIT,
  type FileSearchEntry,
  type FileSearchSource,
} from "./file-search";

function file(name: string, path = name): FileSearchEntry {
  return { name, path, kind: "file" };
}

function source(
  overrides: Partial<FileSearchSource> & Pick<FileSearchSource, "entries">,
): FileSearchSource {
  return {
    serverId: "host-a",
    hostLabel: "Host A",
    workspaceId: "ws-1",
    workspaceName: "c5-proj",
    workspaceRoot: "C:/tmp/c5-proj",
    ...overrides,
  };
}

const keys = (hits: { key: string }[]) => hits.map((hit) => hit.key);

describe("searchFileNames", () => {
  it("empty/whitespace query returns no hits (search mode shows the hint state)", () => {
    const sources = [source({ entries: [file("photo.png")] })];
    expect(searchFileNames(sources, "")).toEqual([]);
    expect(searchFileNames(sources, "   ")).toEqual([]);
  });

  it("matches case-insensitively and reports the display-cased name", () => {
    const hits = searchFileNames([source({ entries: [file("Photo.PNG")] })], "photo.pn");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("Photo.PNG");
    expect(hits[0]!.key).toBe("host-a:ws-1:Photo.PNG");
  });

  it("matches CJK substrings", () => {
    const hits = searchFileNames([source({ entries: [file("中文文档.md")] })], "文档");
    expect(keys(hits)).toEqual(["host-a:ws-1:中文文档.md"]);
  });

  it("directories never match — a hit must be previewable", () => {
    const entries = [
      { name: "docs", path: "docs", kind: "directory" as const },
      { name: "docs.md", path: "docs.md", kind: "file" as const },
    ];
    expect(keys(searchFileNames([source({ entries })], "docs"))).toEqual(["host-a:ws-1:docs.md"]);
  });

  it("ranks name-prefix hits first, then shorter names", () => {
    const entries = [file("report_photo_final.png"), file("photo.png"), file("aphoto.png")];
    const hits = searchFileNames([source({ entries })], "photo");
    expect(hits.map((hit) => hit.name)).toEqual([
      "photo.png",
      "aphoto.png",
      "report_photo_final.png",
    ]);
  });

  it("searches across hosts/workspaces and keeps each host's path", () => {
    const hits = searchFileNames(
      [
        source({ entries: [file("photo.jpg", "shots/photo.jpg")] }),
        source({
          serverId: "host-b",
          hostLabel: "Host B",
          workspaceId: "ws-9",
          workspaceName: "notes",
          workspaceRoot: "/srv/notes",
          entries: [file("photo.png")],
        }),
      ],
      "photo",
    );
    expect(hits.map((hit) => `${hit.hostLabel}|${hit.path}`)).toEqual([
      "Host A|shots/photo.jpg",
      "Host B|photo.png",
    ]);
    expect(hits[0]!.directory).toBe("shots");
    expect(hits[0]!.workspaceRoot).toBe("C:/tmp/c5-proj");
    expect(hits[1]!.workspaceRoot).toBe("/srv/notes");
  });

  it("dedupes the same path loaded twice in one workspace", () => {
    const dup = file("photo.png");
    const hits = searchFileNames([source({ entries: [dup, dup] })], "photo");
    expect(hits).toHaveLength(1);
  });

  it("caps results at the limit", () => {
    const entries = Array.from({ length: FILE_SEARCH_LIMIT + 10 }, (_, index) =>
      file(`photo-${index.toString().padStart(2, "0")}.png`),
    );
    expect(searchFileNames([source({ entries })], "photo")).toHaveLength(FILE_SEARCH_LIMIT);
  });

  it("parent directory: root stays '.', nested keeps separators", () => {
    const hits = searchFileNames(
      [
        source({
          entries: [file("a.md"), file("bb.md", "docs/deep/bb.md"), file("ccc.md", "C:/x/ccc.md")],
        }),
      ],
      ".md",
    );
    expect(hits.map((hit) => hit.directory)).toEqual([".", "docs/deep", "C:/x"]);
  });
});

// C13-F1 (release zero-hit phantom): the browse screen writes explorer state via
// buildWorkspaceExplorerStateKey + setFileExplorer; the 工作区 search reads it back
// via collectBrowsedWorkspaces. These tests pin the writer↔reader contract end to
// end — key format, `root:` exclusion, directory flattening, the sessions-identity
// swap the search memo depends on, and the final BUILD.md hit. Any drift between
// the two sides fails here instead of shipping a silent zero-hit search.
function explorerFile(name: string, path = name): ExplorerEntry {
  return { ...file(name, path), size: 9, modifiedAt: "2026-09-26T00:00:00Z" };
}

function explorerStateWith(entries: ExplorerEntry[]): AgentFileExplorerState {
  return {
    directories: new Map([
      ["root", { path: "root", entries }],
      ["sub", { path: "sub", entries: [] }],
    ]),
    files: new Map(),
    isLoading: false,
    lastError: null,
    pendingRequest: null,
    currentPath: ".",
    history: ["."],
    lastVisitedPath: ".",
    selectedEntryPath: null,
  };
}

const C13F1_SERVER_ID = "c13f1-server";

describe("collectBrowsedWorkspaces (C13-F1 writer↔reader contract)", () => {
  afterEach(() => {
    useSessionStore.getState().clearSession(C13F1_SERVER_ID);
  });

  it("reads back exactly the keys buildWorkspaceExplorerStateKey writes", () => {
    const key = buildWorkspaceExplorerStateKey({
      workspaceId: " wks_27fe ",
      workspaceRoot: "C:/work/paseo-go",
    });
    expect(key).toBe("workspace:wks_27fe");
    const browsed = collectBrowsedWorkspaces(
      new Map([[key!, explorerStateWith([explorerFile("BUILD.md", "paseo-go/BUILD.md")])]]),
    );
    expect(browsed).toHaveLength(1);
    expect(browsed![0]!.workspaceId).toBe("wks_27fe");
    expect(browsed![0]!.entries.map((entry) => entry.path)).toEqual(["paseo-go/BUILD.md"]);
  });

  it("skips root: states — only workspace-scoped entries open in the preview", () => {
    const key = buildWorkspaceExplorerStateKey({ workspaceId: null, workspaceRoot: "/srv/repo" });
    expect(key).toBe("root:/srv/repo");
    expect(
      collectBrowsedWorkspaces(new Map([[key!, explorerStateWith([explorerFile("x.ts")])]])),
    ).toEqual([]);
  });

  it("flattens every loaded directory of the workspace", () => {
    const state = explorerStateWith([]);
    state.directories.set("root", {
      path: "root",
      entries: [explorerFile("README.md"), explorerFile("paseo-go", "paseo-go")],
    });
    state.directories.set("sub", {
      path: "sub",
      entries: [explorerFile("BUILD.md", "paseo-go/BUILD.md")],
    });
    const [browsed] = collectBrowsedWorkspaces(new Map([["workspace:ws", state]]));
    expect(browsed?.entries.map((entry) => entry.path)).toEqual([
      "README.md",
      "paseo-go",
      "paseo-go/BUILD.md",
    ]);
  });

  it("full chain: setFileExplorer write → collect → searchFileNames hits BUILD.md", () => {
    const store = useSessionStore.getState();
    store.initializeSession(C13F1_SERVER_ID, null as never);
    const key = buildWorkspaceExplorerStateKey({
      workspaceId: "wks_27fe",
      workspaceRoot: "C:/work/paseo-go",
    })!;

    const sessionsBefore = useSessionStore.getState().sessions;
    store.setFileExplorer(C13F1_SERVER_ID, (prev) =>
      new Map(prev).set(key, explorerStateWith([explorerFile("BUILD.md", "paseo-go/BUILD.md")])),
    );
    // The search memo depends on the sessions object identity — it must be replaced.
    expect(useSessionStore.getState().sessions).not.toBe(sessionsBefore);

    const session = useSessionStore.getState().sessions[C13F1_SERVER_ID]!;
    const [browsed] = collectBrowsedWorkspaces(session.fileExplorer);
    const hits = searchFileNames(
      [
        source({
          serverId: C13F1_SERVER_ID,
          workspaceId: browsed!.workspaceId,
          entries: browsed!.entries,
        }),
      ],
      "build",
    );
    expect(hits.map((hit) => hit.path)).toEqual(["paseo-go/BUILD.md"]);
  });
});
