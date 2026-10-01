// B4-ROW rulings 4-5 acceptance: the row's two text lines, as pure functions.
// 标题 = 项目(worktree), or the 备注 alone when there is one (B5-TITLE/F12-D), with the
// worktree segment dropping out when it merely repeats the project; 副标题 = 草稿 >
// 需要回复 > 出错 > 预览 (「我: 」 for a user-role last message) > 占位小字
// (B5-SUB/F13: the line is ALWAYS there), every tier collapsed to one line.
import { describe, expect, it } from "vitest";
import {
  buildChatRowTitle,
  buildChatSubtitle,
  selectSubtitlePreview,
  worktreeSegment,
} from "./row-title";

const LABELS = { draft: "草稿", userPrefix: "我: ", empty: "暂无消息" };

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

  it("wraps the worktree in parentheses for a checkout under .paseo/worktrees", () => {
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "/srv/repo/.paseo/worktrees/fix-login",
        note: null,
      }),
    ).toBe("repo(fix-login)");
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "C:\\work\\repo\\.paseo\\worktrees\\feat",
        note: null,
      }),
    ).toBe("repo(feat)");
  });

  it("shows the manual rename alone — no default summary, no project prefix", () => {
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "登录修复" })).toBe(
      "登录修复",
    );
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "/srv/repo/.paseo/worktrees/feat",
        note: "ship it",
      }),
    ).toBe("ship it");
  });

  it("falls back to the default title for a blank or whitespace-only note", () => {
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "   " })).toBe("repo");
    expect(
      buildChatRowTitle({
        projectName: "repo",
        cwd: "/srv/repo/.paseo/worktrees/feat",
        note: "",
      }),
    ).toBe("repo(feat)");
  });

  it("collapses a multiline note onto one line", () => {
    expect(buildChatRowTitle({ projectName: "repo", cwd: "/srv/repo", note: "a\n  b" })).toBe(
      "a b",
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
    ).toBe("急");
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

  // B5-SUB (F13 口径: 任何情况下小字必须显示). The three wire postures of a
  // missing preview (undefined = old daemon, null = "no messages", blank) all
  // land on the placeholder — the second line never collapses.
  it("falls back to the placeholder for an absent, null, or blank preview", () => {
    expect(buildChatSubtitle({ ...base, preview: undefined })).toEqual([
      { tone: "body", text: "暂无消息" },
    ]);
    expect(buildChatSubtitle({ ...base, preview: null })).toEqual([
      { tone: "body", text: "暂无消息" },
    ]);
    expect(buildChatSubtitle({ ...base, preview: "   \n " })).toEqual([
      { tone: "body", text: "暂无消息" },
    ]);
  });

  it("the placeholder never displaces a real tier", () => {
    // 草稿 / 状态标记 / 预览 each keep the line they always owned.
    expect(buildChatSubtitle({ ...base, draftText: "草稿内容" })).toEqual([
      { tone: "flag", text: "[草稿] " },
      { tone: "body", text: "草稿内容" },
    ]);
    expect(buildChatSubtitle({ ...base, flagLabel: "出错" })).toEqual([
      { tone: "flag", text: "[出错] " },
    ]);
    expect(buildChatSubtitle({ ...base, preview: "done" })).toEqual([
      { tone: "body", text: "done" },
    ]);
  });

  it("renders no segment when even the locale string is blank", () => {
    // The one honest empty: nothing renderable exists. (No device locale does.)
    expect(buildChatSubtitle({ ...base, labels: { ...LABELS, empty: "  " } })).toEqual([]);
  });
});

describe("selectSubtitlePreview (B5-SUB keep-old-value read)", () => {
  // The regression the card pins: 字段缺失时不清空已显示小字. A blank directory
  // value (any wire posture) never wins over the shell-remembered preview; a
  // real incoming value always does (the daemon re-derives on resume, and that
  // newer fact must land).
  it("keeps the remembered preview when the field goes missing", () => {
    expect(selectSubtitlePreview(null, "上一条消息")).toBe("上一条消息");
    expect(selectSubtitlePreview(undefined, "上一条消息")).toBe("上一条消息");
    expect(selectSubtitlePreview("   ", "上一条消息")).toBe("上一条消息");
  });

  it("prefers the live directory value whenever it carries text", () => {
    expect(selectSubtitlePreview("新消息", "上一条消息")).toBe("新消息");
  });

  it("reads null when neither source has anything (placeholder tier takes over)", () => {
    expect(selectSubtitlePreview(null, null)).toBeNull();
    expect(selectSubtitlePreview(undefined, undefined)).toBeNull();
    expect(selectSubtitlePreview(" \n ", "")).toBeNull();
  });
});
