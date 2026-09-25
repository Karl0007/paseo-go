// F6 + F6b regression (security lane): a `paseogo://` deep link can carry any
// workspaceRoot/path pair. Stage ①: the resolved workspace descriptor always
// outranks the param (F6). Stage ②: with no descriptor the param survives ONLY
// as an exact match against the user's own favorites snapshot — same host,
// equal root, path at/under the snapshot entry (F6b). Stage ③: everything else
// is denied before any daemon request. The boundary table below is the card's
// acceptance list (descriptor priority / favorite match / mismatch / cross-host
// / prefix-spoof) plus the separator, case and `..` edges the comparison owns.
import { describe, expect, it } from "vitest";
import { resolvePreviewRoot, type PreviewFavoriteSnapshot } from "./preview-root";

const FAV: PreviewFavoriteSnapshot = {
  hostId: "srv-A",
  workspaceRoot: "/home/dev/projects/app",
  path: "docs/notes.md",
};

function offline(input: Partial<Parameters<typeof resolvePreviewRoot>[0]>) {
  return resolvePreviewRoot({ hostId: FAV.hostId, ...input });
}

describe("resolvePreviewRoot — ① descriptor wins outright", () => {
  it("descriptor outranks a hostile param root", () => {
    expect(
      resolvePreviewRoot({
        paramRoot: "/home/victim/.ssh",
        descriptorRoot: "/home/dev/projects/app",
        paramPath: "id_rsa",
      }),
    ).toEqual({ kind: "descriptor", root: "/home/dev/projects/app", path: "id_rsa" });
  });

  it("descriptor wins even against a prefix param (broader scope stays closed)", () => {
    expect(
      resolvePreviewRoot({
        paramRoot: "/home/dev",
        descriptorRoot: "/home/dev/projects/app",
      }),
    ).toEqual({ kind: "descriptor", root: "/home/dev/projects/app", path: "" });
  });

  it("descriptor hit bypasses the favorites gate entirely (online explorer)", () => {
    expect(
      resolvePreviewRoot({
        hostId: "srv-A",
        paramRoot: "/home/dev/projects/app",
        paramPath: "anything/at/all.md",
        descriptorRoot: "/home/dev/projects/app",
        favorites: [],
      }),
    ).toEqual({
      kind: "descriptor",
      root: "/home/dev/projects/app",
      path: "anything/at/all.md",
    });
  });

  it("descriptor is trimmed; blank falls through to the favorites stage", () => {
    expect(resolvePreviewRoot({ descriptorRoot: "  /srv/b  ", paramPath: "a.md" })).toEqual({
      kind: "descriptor",
      root: "/srv/b",
      path: "a.md",
    });
    expect(offline({ paramRoot: "/srv/notes", paramPath: "a.md", descriptorRoot: "   " })).toEqual({
      kind: "denied",
    });
  });
});

describe("resolvePreviewRoot — ② favorites snapshot is the only fallback anchor", () => {
  it("exact favorite match yields the snapshot root+path (offline favorite)", () => {
    expect(
      offline({
        paramRoot: "/home/dev/projects/app",
        paramPath: "docs/notes.md",
        favorites: [FAV],
      }),
    ).toEqual({ kind: "favorite", root: "/home/dev/projects/app", path: "docs/notes.md" });
  });

  it("match survives cosmetic drift: root trailing separators, param whitespace", () => {
    expect(
      offline({
        paramRoot: "/home/dev/projects/app/",
        paramPath: " docs/notes.md ",
        favorites: [FAV],
      }),
    ).toEqual({ kind: "favorite", root: "/home/dev/projects/app", path: "docs/notes.md" });
  });

  it("separator unification: backslash param matches a slash snapshot (Windows host)", () => {
    const winFav: PreviewFavoriteSnapshot = {
      hostId: "srv-A",
      workspaceRoot: "C:\\Users\\dev\\proj",
      path: "src\\app.ts",
    };
    expect(
      offline({ paramRoot: "C:/Users/dev/proj", paramPath: "src/app.ts", favorites: [winFav] }),
    ).toEqual({ kind: "favorite", root: "C:\\Users\\dev\\proj", path: "src\\app.ts" });
  });

  it("descendant of a directory favorite is admitted with its normalized path", () => {
    const dirFav: PreviewFavoriteSnapshot = { ...FAV, path: "docs" };
    expect(
      offline({ paramRoot: FAV.workspaceRoot, paramPath: "docs/sub/deep.md", favorites: [dirFav] }),
    ).toEqual({ kind: "favorite", root: FAV.workspaceRoot, path: "docs/sub/deep.md" });
  });

  it("in-tree `..` that resolves onto the snapshot is the same lexical file", () => {
    expect(
      offline({
        paramRoot: FAV.workspaceRoot,
        paramPath: "docs/tmp/../notes.md",
        favorites: [FAV],
      }),
    ).toEqual({ kind: "favorite", root: FAV.workspaceRoot, path: "docs/notes.md" });
  });
});

describe("resolvePreviewRoot — ③ everything else is denied", () => {
  it("cross-host match is rejected (favorite on srv-B, link aimed at srv-A)", () => {
    expect(
      offline({
        paramRoot: FAV.workspaceRoot,
        paramPath: FAV.path,
        favorites: [{ ...FAV, hostId: "srv-B" }],
      }),
    ).toEqual({ kind: "denied" });
  });

  it("root mismatch is rejected even when the path equals the favorite", () => {
    expect(
      offline({ paramRoot: "/home/dev/projects/other", paramPath: FAV.path, favorites: [FAV] }),
    ).toEqual({ kind: "denied" });
  });

  it("sibling file under the same root is rejected (favorite gates per entry, not per tree)", () => {
    expect(
      offline({ paramRoot: FAV.workspaceRoot, paramPath: "docs/other.md", favorites: [FAV] }),
    ).toEqual({ kind: "denied" });
  });

  it("string-prefix spoof: favorite notes.txt must not admit notes.txt.evil", () => {
    const fav: PreviewFavoriteSnapshot = { ...FAV, path: "notes.txt" };
    expect(
      offline({ paramRoot: FAV.workspaceRoot, paramPath: "notes.txt.evil", favorites: [fav] }),
    ).toEqual({ kind: "denied" });
  });

  it("card case: favorite /a/b.txt, link root=/a&path=../../windows/win.ini → denied", () => {
    expect(
      resolvePreviewRoot({
        hostId: "srv-A",
        paramRoot: "/a",
        paramPath: "../../windows/win.ini",
        favorites: [{ hostId: "srv-A", workspaceRoot: "/a", path: "/a/b.txt" }],
      }),
    ).toEqual({ kind: "denied" });
  });

  it("escape through the favorite itself: /a/b.txt/../../windows/win.ini → denied", () => {
    expect(
      resolvePreviewRoot({
        hostId: "srv-A",
        paramRoot: "/a",
        paramPath: "/a/b.txt/../../windows/win.ini",
        favorites: [{ hostId: "srv-A", workspaceRoot: "/a", path: "/a/b.txt" }],
      }),
    ).toEqual({ kind: "denied" });
  });

  it("case divergence is denied (case-folding would leak files on case-sensitive hosts)", () => {
    expect(
      offline({ paramRoot: FAV.workspaceRoot, paramPath: "docs/Notes.md", favorites: [FAV] }),
    ).toEqual({ kind: "denied" });
  });

  it("absolute-vs-relative mixing is denied (no implicit root joining)", () => {
    expect(
      offline({
        paramRoot: FAV.workspaceRoot,
        paramPath: "/home/dev/projects/app/docs/notes.md",
        favorites: [FAV],
      }),
    ).toEqual({ kind: "denied" });
  });

  it('a root-blessing favorite anchor (".") is never trusted', () => {
    expect(
      offline({
        paramRoot: FAV.workspaceRoot,
        paramPath: ".ssh/id_rsa",
        favorites: [{ ...FAV, path: "." }],
      }),
    ).toEqual({ kind: "denied" });
  });

  it("missing host/root/path or empty favorites deny; nothing anywhere yields a readable root", () => {
    expect(offline({ paramRoot: FAV.workspaceRoot, paramPath: FAV.path })).toEqual({
      kind: "denied",
    });
    expect(offline({ paramRoot: FAV.workspaceRoot, paramPath: FAV.path, favorites: [] })).toEqual({
      kind: "denied",
    });
    expect(offline({ paramPath: FAV.path, favorites: [FAV] })).toEqual({ kind: "denied" });
    expect(offline({ paramRoot: FAV.workspaceRoot, favorites: [FAV] })).toEqual({ kind: "denied" });
    expect(
      offline({ hostId: "", paramRoot: FAV.workspaceRoot, paramPath: FAV.path, favorites: [FAV] }),
    ).toEqual({ kind: "denied" });
    expect(resolvePreviewRoot({})).toEqual({ kind: "denied" });
  });
});
