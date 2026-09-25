// F6 regression (security lane): a `paseogo://` deep link can carry any workspaceRoot
// param. While the param outranked the resolved workspace descriptor, a malicious
// link drove the preview screen into reading arbitrary host paths. The descriptor
// always wins; the param survives only as the offline-favorites fallback (no
// descriptor) — the exact priority the fix inverted.
import { describe, expect, it } from "vitest";
import { resolvePreviewRoot } from "./preview-root";

describe("resolvePreviewRoot", () => {
  it("descriptor outranks a hostile param root", () => {
    expect(
      resolvePreviewRoot({
        paramRoot: "/home/victim/.ssh",
        descriptorRoot: "/home/dev/projects/app",
      }),
    ).toBe("/home/dev/projects/app");
  });

  it("descriptor wins even against a prefix param (broader scope stays closed)", () => {
    expect(
      resolvePreviewRoot({
        paramRoot: "/home/dev",
        descriptorRoot: "/home/dev/projects/app",
      }),
    ).toBe("/home/dev/projects/app");
  });

  it("param is the fallback only when no descriptor resolved (offline favorite)", () => {
    expect(resolvePreviewRoot({ paramRoot: "/srv/notes", descriptorRoot: "" })).toBe("/srv/notes");
    expect(resolvePreviewRoot({ paramRoot: "/srv/notes", descriptorRoot: undefined })).toBe(
      "/srv/notes",
    );
  });

  it("trims; nothing anywhere yields the empty root the screen refuses", () => {
    expect(resolvePreviewRoot({ paramRoot: "  /srv/a  ", descriptorRoot: "  /srv/b " })).toBe(
      "/srv/b",
    );
    expect(resolvePreviewRoot({})).toBe("");
  });
});
