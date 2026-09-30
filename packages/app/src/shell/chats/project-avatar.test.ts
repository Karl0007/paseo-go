// B4-ROW ruling 3 acceptance: the project tile is DETERMINISTIC. Same name → same
// glyph and same palette slot, every call, every launch; the colour is the official
// identity palette (so a project's tile matches its icon everywhere else in the app);
// and the function is total — an empty or hostile name still yields a renderable tile.
import { describe, expect, it } from "vitest";
import {
  IDENTITY_COLOR_NAMES,
  deriveIdentityColorName,
  identityColor,
} from "@/styles/identity-colors";
import { projectAvatarFor, projectInitial } from "./project-avatar";

const PALETTE = new Set(IDENTITY_COLOR_NAMES.map(identityColor));

describe("projectInitial", () => {
  it("takes a Han name whole and uppercases a Latin one", () => {
    expect(projectInitial("工作台")).toBe("工");
    expect(projectInitial("paseo-go")).toBe("P");
    expect(projectInitial("Release Notes")).toBe("R");
  });

  it("ignores leading whitespace and keeps digits", () => {
    expect(projectInitial("  paseo")).toBe("P");
    expect(projectInitial("3d-viewer")).toBe("3");
  });

  it("yields one whole glyph for an astral first character (no split surrogate)", () => {
    expect(projectInitial("😀repo")).toBe("😀");
  });

  it("falls back to a placeholder for an empty or whitespace-only name", () => {
    expect(projectInitial("")).toBe("?");
    expect(projectInitial("   \n ")).toBe("?");
  });
});

describe("projectAvatarFor", () => {
  it("is referentially stable for the same name", () => {
    expect(projectAvatarFor("paseo-go")).toEqual(projectAvatarFor("paseo-go"));
  });

  it("paints the identity palette slot the rest of the app gives the same project", () => {
    const avatar = projectAvatarFor("paseo");
    expect(avatar.colorName).toBe(deriveIdentityColorName("paseo"));
    expect(avatar.color).toBe(identityColor(avatar.colorName));
    expect(PALETTE.has(avatar.color)).toBe(true);
  });

  it("hashes the trimmed name, so padding never recolours a project", () => {
    expect(projectAvatarFor("  paseo  ")).toEqual(projectAvatarFor("paseo"));
  });

  it("stays total and in-palette across names that share an initial or a script", () => {
    const seen = new Set<string>();
    for (const name of ["", "a", "A", "工作台", "paseo", "paseo-go", "  ", "😀repo"]) {
      const avatar = projectAvatarFor(name);
      expect(PALETTE.has(avatar.color)).toBe(true);
      expect([...avatar.initial]).toHaveLength(1);
      seen.add(avatar.colorName);
    }
    // Ten slots over eight inputs: the hash must actually spread them, or the tiles
    // would tell projects apart by glyph alone.
    expect(seen.size).toBeGreaterThan(1);
  });
});
