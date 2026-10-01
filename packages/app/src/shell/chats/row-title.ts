// Row text model (B4-ROW, batch-4 F4 rulings 4-5): what the 对话 row says, computed
// from plain strings so the row component stays a renderer and the rules stay
// unit-testable without React Native. No i18n here — translated fragments arrive
// through `labels`, injected by the caller.
//
// Title  = 项目名(worktree)   (B5-TITLE/F12-D: parentheses; a 备注 = the shell
//          rename (alias) alone — D21/B6-TITLE: `agent.title` is never a 备注, the
//          daemon stamps it with the first prompt at birth)
// Subtitle priority: [草稿]+draft text > [需要回复]+preview > [出错]+preview >
//                    「我: 」/bare preview > 占位小字 (B5-SUB/F13: the second line is
//                    ALWAYS there — an all-empty chain renders the translated
//                    placeholder, it never collapses the row).
// The red bracket tiers come from `flagLabel`, which the row reads from
// ACTIVITY_LABEL_KEY — the same map the C9 search haystack uses, so what a user
// can see is what they can search.

/** One run of subtitle text; `flag` is the red bracketed state mark. */
export type ChatSubtitleTone = "flag" | "body";

export interface ChatSubtitleSegment {
  tone: ChatSubtitleTone;
  text: string;
}

export interface ChatSubtitleLabels {
  /** 「草稿」/ "Draft" — rendered as `[草稿] `. */
  draft: string;
  /** 「我: 」/ "Me: " — already carries its separator, user-role previews only. */
  userPrefix: string;
  /** 「暂无消息」/ "No messages yet" — B5-SUB: the all-empty fallback line. */
  empty: string;
}

export interface ChatSubtitleInput {
  /** Unsent composer text for this chat (draft store); blank means no draft. */
  draftText: string;
  /** Translated state word for the row's bucket (需要回复 / 出错); null = no mark. */
  flagLabel: string | null;
  /**
   * Protocol `lastMessagePreview`. `undefined` = the daemon predates the field and
   * `null` = the agent has no messages; both render as no preview (B4-PREVIEW
   * contract), which is why the pair is not narrowed to `string`.
   */
  preview: string | null | undefined;
  previewRole: "user" | "assistant" | "other" | null | undefined;
  labels: ChatSubtitleLabels;
}

/**
 * Collapse to one line. A draft is free-form multiline text and the subtitle is
 * `numberOfLines={1}`, so every whitespace run becomes a single space — the same
 * normalisation the server applies to the preview.
 */
function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * B5-SUB (F13) keep-old-value read: the directory's incremental merge is a
 * whole-object replace, and a pre-B4 daemon record reports `lastMessagePreview`
 * as null even for chats WITH messages (the daemon flattens "not derived" to
 * "no messages" — see evidence/B5-SUB/ws-frames-before.txt). The row therefore
 * never trusts a blank incoming over the preview it has already shown: a blank
 * (`undefined`/`null`/whitespace) falls back to the shell-remembered value.
 */
export function selectSubtitlePreview(
  incoming: string | null | undefined,
  remembered: string | null | undefined,
): string | null {
  if (typeof incoming === "string" && singleLine(incoming).length > 0) return incoming;
  if (typeof remembered === "string" && singleLine(remembered).length > 0) return remembered;
  return null;
}

export function buildChatSubtitle(input: ChatSubtitleInput): ChatSubtitleSegment[] {
  const flag = singleLine(input.flagLabel);
  const preview = singleLine(input.preview);
  const draft = singleLine(input.draftText);

  // 草稿 outranks everything: the user's own unsent words are the newest fact about
  // the chat, and they vanish the moment the box is emptied (WeChat's own rule).
  if (draft.length > 0) {
    const draftFlag = singleLine(input.labels.draft);
    const segments: ChatSubtitleSegment[] = [];
    if (draftFlag) segments.push({ tone: "flag", text: `[${draftFlag}] ` });
    segments.push({ tone: "body", text: draft });
    return segments;
  }

  const segments: ChatSubtitleSegment[] = [];
  if (flag) segments.push({ tone: "flag", text: `[${flag}] ` });
  if (preview.length > 0) {
    segments.push({
      tone: "body",
      // A user-role last message is the user talking TO the agent, which reads as
      // 「我: 」in a single-chat list; assistant/other need no prefix.
      text: input.previewRole === "user" ? `${input.labels.userPrefix}${preview}` : preview,
    });
  }
  // B5-SUB (F13 口径: 任何情况下小字必须显示): a chat with neither mark nor message
  // shows the placeholder line, never a collapsed second line. A blank locale
  // string is the one case that can still yield no segment — nothing renderable.
  if (segments.length === 0) {
    const empty = singleLine(input.labels.empty);
    if (empty.length > 0) segments.push({ tone: "body", text: empty });
  }
  return segments;
}

/**
 * Last path segment of a working directory, on either separator. The daemon reports
 * POSIX-shaped cwd for remote hosts and Windows-shaped ones for local hosts, and the
 * worktree name is the tail of whichever the agent happens to run in.
 */
export function worktreeSegment(cwd: string): string {
  const segments = cwd.split(/[/\\]+/).filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  // A bare Windows drive root (`C:\`) would otherwise title itself "C:".
  return /^[A-Za-z]:$/.test(last) ? "" : last;
}

export interface ChatRowTitleInput {
  /** `resolveProjectPlacement().projectName` — the same source the row always used. */
  projectName: string;
  cwd: string;
  /**
   * An explicit 备注 (the shell rename lives OUTSIDE this builder: the row applies
   * the alias before calling it, D21). `agent.title` MUST NOT be passed — a daemon
   * stamps it with the first prompt at birth, so it is a provisional summary, not a
   * rename. `null`/blank = no 备注, the default `项目(worktree)` renders.
   */
  note: string | null | undefined;
}

/**
 * `项目(worktree)`, or the 备注 alone when there is one (B5-TITLE ruling F12/D: a
 * manual rename IS the title — no default summary, no project prefix). The worktree
 * segment drops out when it repeats the project (a plain checkout, where cwd's tail
 * IS the project directory) so the common case reads 「paseo」 and not
 * 「paseo(paseo)」. A `/` in the project name is a remote owner/repo
 * (deriveProjectName hands GitHub keys through as `getpaseo/paseo`) — the row shows
 * the repo short name, the owner adds noise at 14sp (B4-ROW tail).
 */
export function buildChatRowTitle(input: ChatRowTitleInput): string {
  const note = singleLine(input.note);
  if (note.length > 0) {
    return note;
  }
  const projectSegments = singleLine(input.projectName).split("/").filter(Boolean);
  const project = projectSegments[projectSegments.length - 1] ?? "";
  const worktree = singleLine(worktreeSegment(input.cwd));
  const worktreeIsProject =
    worktree.length > 0 && worktree.toLocaleLowerCase() === project.toLocaleLowerCase();
  return worktree.length > 0 && !worktreeIsProject ? `${project}(${worktree})` : project;
}
