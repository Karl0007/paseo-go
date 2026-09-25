// C6 acceptance: the preview dispatcher's full type matrix and its boundary cases —
// apk/png/md/ts/html must land on distinct surfaces, the >5MB text gate must flip
// only for text-like kinds, extensionless and dotfile names must stay text, and
// CJK/uppercase/Windows-separator names must dispatch like their ASCII twins.
import { describe, expect, it } from "vitest";
import { LARGE_TEXT_LIMIT_BYTES, previewKind } from "./preview-kind";

const MB = 1024 * 1024;

describe("previewKind kind dispatch", () => {
  it("maps the fixture matrix onto the six surfaces", () => {
    expect(previewKind("installer.apk").kind).toBe("binary");
    expect(previewKind("photo.png").kind).toBe("image");
    expect(previewKind("photo.JPG").kind).toBe("image");
    expect(previewKind("notes.md").kind).toBe("markdown");
    expect(previewKind("widget.ts").kind).toBe("code");
    expect(previewKind("page.html").kind).toBe("html");
    expect(previewKind("clip.mp4").kind).toBe("video");
    expect(previewKind("big.txt").kind).toBe("text");
  });

  it("keeps extensionless and dotfile names on the text surface", () => {
    expect(previewKind("LICENSE").kind).toBe("text");
    expect(previewKind("src/deep/dir/README").kind).toBe("text");
    expect(previewKind(".gitignore").kind).toBe("text");
    expect(previewKind(".env").kind).toBe("text");
  });

  it("treats unknown extensions as binary, multi-dot tails included", () => {
    expect(previewKind("archive.tar.gz").kind).toBe("binary");
    expect(previewKind("model.gguf").kind).toBe("binary");
    expect(previewKind("notes.md.not").kind).toBe("binary");
  });

  it("dispatches CJK names by their extension, separators included", () => {
    expect(previewKind("中文文档.md").kind).toBe("markdown");
    expect(previewKind("docs/中文/图片.PNG").kind).toBe("image");
    expect(previewKind("docs\\中文\\安装包.apk").kind).toBe("binary");
    expect(previewKind("中文无后缀").kind).toBe("text");
  });
});

describe("previewKind large-text gate", () => {
  it("flips exactly above the 5MB budget for text-like kinds", () => {
    expect(previewKind("big.txt", LARGE_TEXT_LIMIT_BYTES).largeText).toBe(false);
    expect(previewKind("big.txt", LARGE_TEXT_LIMIT_BYTES + 1).largeText).toBe(true);
    expect(previewKind("huge.ts", 6 * MB).largeText).toBe(true);
    expect(previewKind("huge.md", 6 * MB).largeText).toBe(true);
    expect(previewKind("huge.html", 6 * MB).largeText).toBe(true);
  });

  it("never flags media or binary as large text", () => {
    expect(previewKind("movie.mp4", 700 * MB).largeText).toBe(false);
    expect(previewKind("installer.apk", 250 * MB).largeText).toBe(false);
    expect(previewKind("photo.png", 8 * MB).largeText).toBe(false);
  });

  it("defaults size 0 (unstat'd file) to a normal render", () => {
    expect(previewKind("big.txt").largeText).toBe(false);
  });
});
