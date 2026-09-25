// Preview type dispatcher (card C6, DESIGN §5): one pure function decides which
// preview surface a workspace file gets, from its path (+ size for the large-text
// gate). The preview screen maps kinds onto surfaces: image/markdown/html/code/text
// mount the official FilePane pipeline (ZoomableImage / markdown renderer / CSP
// webview / highlighted source); video and binary render the shell info card with
// the official download pipeline buttons; `largeText` (>5MB text-like, per the card
// ruling) never mounts a full render — the official readFile RPC is all-or-nothing
// (maxBytes errors, the download endpoint has no Range), so the header-preview
// degradation is a hint card + download.
export type ShellPreviewKind = "image" | "video" | "markdown" | "html" | "code" | "text" | "binary";

export interface ShellPreviewPlan {
  kind: ShellPreviewKind;
  /** Text-like file above the render budget: no full-text render, hint card only. */
  largeText: boolean;
}

export const LARGE_TEXT_LIMIT_BYTES = 5 * 1024 * 1024;

type ExtensionTable = Record<string, true>;

const IMAGE_EXTENSIONS: ExtensionTable = {
  png: true,
  jpg: true,
  jpeg: true,
  gif: true,
  webp: true,
  bmp: true,
  ico: true,
  heic: true,
  heif: true,
  avif: true,
  tiff: true,
  tif: true,
};

const VIDEO_EXTENSIONS: ExtensionTable = {
  mp4: true,
  mov: true,
  m4v: true,
  webm: true,
  mkv: true,
  avi: true,
  "3gp": true,
  mpg: true,
  mpeg: true,
};

const MARKDOWN_EXTENSIONS: ExtensionTable = { md: true, markdown: true, mdx: true };
const HTML_EXTENSIONS: ExtensionTable = { html: true, htm: true, xhtml: true };

const CODE_EXTENSIONS: ExtensionTable = {
  ts: true,
  tsx: true,
  js: true,
  jsx: true,
  mjs: true,
  cjs: true,
  json: true,
  py: true,
  go: true,
  rs: true,
  java: true,
  rb: true,
  php: true,
  c: true,
  h: true,
  cpp: true,
  cc: true,
  hpp: true,
  cs: true,
  swift: true,
  kt: true,
  kts: true,
  sh: true,
  bash: true,
  zsh: true,
  fish: true,
  ps1: true,
  bat: true,
  cmd: true,
  sql: true,
  yml: true,
  yaml: true,
  toml: true,
  xml: true,
  svg: true,
  css: true,
  scss: true,
  less: true,
  vue: true,
  lua: true,
  r: true,
  pl: true,
  dart: true,
  scala: true,
  gradle: true,
  groovy: true,
  graphql: true,
  proto: true,
};

const TEXT_EXTENSIONS: ExtensionTable = {
  txt: true,
  log: true,
  csv: true,
  tsv: true,
  ini: true,
  cfg: true,
  conf: true,
};

const isTextLikeKind = (kind: ShellPreviewKind): boolean =>
  kind === "markdown" || kind === "html" || kind === "code" || kind === "text";
/**
 * Lowercased extension of the basename, or "" when there is none. Dotfiles
 * (".env", ".gitignore") count as extensionless → text; "a.tar.gz" → "gz".
 * Works for both POSIX and Windows separators and for non-ASCII names — only
 * the segment after the last dot is inspected.
 */
function extensionOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop()?.trim() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

export function previewKind(filePath: string, size = 0): ShellPreviewPlan {
  const ext = extensionOf(filePath);
  let kind: ShellPreviewKind;
  if (ext in IMAGE_EXTENSIONS) kind = "image";
  else if (ext in VIDEO_EXTENSIONS) kind = "video";
  else if (ext in MARKDOWN_EXTENSIONS) kind = "markdown";
  else if (ext in HTML_EXTENSIONS) kind = "html";
  else if (ext in CODE_EXTENSIONS) kind = "code";
  // No extension at all (LICENSE, README, dotfiles) reads far more often than
  // it is binary, so unknown-extension is binary but extensionless stays text.
  else if (ext === "" || ext in TEXT_EXTENSIONS) kind = "text";
  else kind = "binary";
  return {
    kind,
    largeText: isTextLikeKind(kind) && size > LARGE_TEXT_LIMIT_BYTES,
  };
}
