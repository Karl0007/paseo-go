// B4-ROW rulings 4-5 acceptance: the row's two text lines, as pure functions.
// 标题 = 项目-worktree[-备注] with the worktree segment dropping out when it merely
// repeats the project; 副标题 = 草稿 > 需要回复 > 出错 > 预览 (「我: 」 for a user-role
// last message) > nothing, every tier collapsed to one line.
import { describe, expect, it } from "vitest";
import { buildChatRowTitle, buildChatSubtitle, worktreeSegment } from "./row-title";

const LABELS = { draft: "草稿", userPrefix: "我: " };

describe("worktreeSegment", () => {
  it("reads the tail of a POSIX or a Windows path, and no trailing separator", () => {
    expect(worktreeSegment("/home/dev/paseo")).toBe("paseo");
    expect(worktreeSegment("C:\\work\\paseo-go")).toBe("paseo-go");
    expect(worktreeSegment("/home/dev/paseo/")).toBe("paseo");
  });

  it("treats a bare drive root as no worktree (「C:」 is not a name)", () => {
    expect(worktreeSegment("C:\\")).toBe("");
    expect(worktreeSegment("")).toBe("");
  });
});

describe("buildChatRowTitle", () => {
  it("collapses to the project alone when cwd's tail IS the project", () => {
    expect(buildChatRowTitle({ projectName: "paseo", cwd: "/home/dev/paseo", note: null })).toBe(
      "paseo",
    );
  });

  it("appends the worktree for a checkout under .paseo/worktrees", () => {
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "/srv/repo/.paseo/worktrees/fix-login",
        note: null,
      }),
    ).toBe("repo-fix-login");
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "C:\\work\\repo\\.paseo\\worktrees\\feat",
        note: null,
      }),
    ).toBe("repo-feat");
  });

  it("appends the manual rename as the trailing 备注 segment", () => {
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "登录修复" })).toBe(
      "repo-登录修复",
    );
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "/srv/repo/.paseo/worktrees/feat",
        note: "ship it",
      }),
    ).toBe("repo-feat-ship it");
  });

  it("drops a blank or whitespace-only note instead of trailing a dash", () => {
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "   " })).toBe("repo");
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "" })).toBe("repo");
  });

  it("collapses a multiline note onto one line", () => {
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "a\n  b" })).toBe(
      "repo-a b",
    );
  });

  // B4-ROW tail: deriveProjectName passes GitHub remote keys through as
  // `owner/repo` — the row shows the repo short name.
  it("shortens an owner/repo project name to the repo segment", () => {
    expect(
      buildChatRowTitle({ projectName: "getpaseo/paseo", cwd: "/srv/paseo", note: null }),
    ).toBe("paseo");
    expect(
      buildChatRowTitle({ projectName: "getpaseo/paseo", cwd: "/home/dev/paseo", note: "急" }),
    ).toBe("paseo-急");
    // A trailing separator must not invent an empty project.
    expect(buildChatRowTitle({ projectName: "org/repo/", cwd: "/srv/repo", note: null })).toBe(
      "repo",
    );
  });
});

describe("buildChatSubtitle", () => {
  const base = {
    draftText: "",
    flagLabel: null,
    preview: null,
    previewRole: null,
    labels: LABELS,
  } as const;

  it("草稿 outranks the state mark and the preview alike", () => {
    expect(
      buildChatSubtitle({
        ...base,
        draftText: "先跑一下测试",
        flagLabel: "需要回复",
        preview: "上一条消息",
        previewRole: "assistant",
      }),
    ).toEqual([
      { tone: "flag", text: "[草稿] " },
      { tone: "body", text: "先跑一下测试" },
    ]);
  });

  it("collapses a multiline draft onto the single subtitle line", () => {
    expect(buildChatSubtitle({ ...base, draftText: "第一行\n第二行  " })).toEqual([
      { tone: "flag", text: "[草稿] " },
      { tone: "body", text: "第一行 第二行" },
    ]);
  });

  it("需要回复 leads the preview when the chat waits for an approval", () => {
    expect(buildChatSubtitle({ ...base, flagLabel: "需要回复", preview: "允许执行 rm?" })).toEqual([
      { tone: "flag", text: "[需要回复] " },
      { tone: "body", text: "允许执行 rm?" },
    ]);
  });

  it("a flagged chat with no messages yet still shows its mark", () => {
    expect(buildChatSubtitle({ ...base, flagLabel: "出错" })).toEqual([
      { tone: "flag", text: "[出错] " },
    ]);
  });

  it("prefixes a user-role preview and leaves assistant/other bare", () => {
    expect(buildChatSubtitle({ ...base, preview: "改完了", previewRole: "user" })).toEqual([
      { tone: "body", text: "我: 改完了" },
    ]);
    expect(buildChatSubtitle({ ...base, preview: "done", previewRole: "assistant" })).toEqual([
      { tone: "body", text: "done" },
    ]);
    expect(buildChatSubtitle({ ...base, preview: "boom", previewRole: "other" })).toEqual([
      { tone: "body", text: "boom" },
    ]);
  });

  it("renders nothing for an absent preview and for an empty one", () => {
    // B4-PREVIEW contract: undefined = old daemon, null = no messages — both are
    // "no preview", and neither may leak the word "null" onto the row.
    expect(buildChatSubtitle({ ...base, preview: undefined })).toEqual([]);
    expect(buildChatSubtitle({ ...base, preview: null })).toEqual([]);
    expect(buildChatSubtitle({ ...base, preview: "   \n " })).toEqual([]);
  });
});
