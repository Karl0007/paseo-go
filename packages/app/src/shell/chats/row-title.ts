// Row text model (B4-ROW, batch-4 F4 rulings 4-5): what the 对话 row says, computed
// from plain strings so the row component stays a renderer and the rules stay
// unit-testable without React Native. No i18n here — translated fragments arrive
// through `labels`, injected by the caller.
//
// Title  = 项目名-worktree[-备注]   (备注 = the manual rename, `agent.title`)
// Subtitle priority: [草稿]+draft text > [需要回复]+preview > [出错]+preview >
//                    「我: 」/bare preview > nothing.
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
  // A flagged chat with nothing said yet still shows its mark; a chat with neither
  // mark nor message shows no second line at all.
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
  /** `agent.title`: the manual rename, which becomes the trailing 备注 segment. */
  note: string | null | undefined;
}

/**
 * `项目-worktree[-备注]`. The worktree segment drops out when it repeats the project
 * (a plain checkout, where cwd's tail IS the project directory) so the common case
 * reads 「paseo」 and not 「paseo-paseo」.
 */
export function buildChatRowTitle(input: ChatRowTitleInput): string {
  const project = singleLine(input.projectName);
  const worktree = singleLine(worktreeSegment(input.cwd));
  const note = singleLine(input.note);
  const worktreeIsProject =
    worktree.length > 0 && worktree.toLocaleLowerCase() === project.toLocaleLowerCase();
  const head = worktree.length > 0 && !worktreeIsProject ? `${project}-${worktree}` : project;
  return note.length > 0 ? `${head}-${note}` : head;
}
