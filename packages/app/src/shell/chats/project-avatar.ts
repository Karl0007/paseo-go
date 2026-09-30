// Row avatar (B4-ROW, batch-4 F4 ruling 3): the chat row's tile stands for the
// PROJECT, not the provider. There is no icon data source anywhere in the protocol,
// so the tile is generated — first character of the project name on a rounded square
// filled with the project's hash colour. `projectAvatarFor` is pure and total: the
// same name yields the same glyph and the same palette slot on every device and every
// launch, with nothing stored.
//
// The palette is the official identity palette (`styles/identity-colors`), reused
// rather than re-derived: ten muted fills already normalised to one contrast band
// against a white glyph, so a column of project tiles reads as a list instead of a
// fight. `deriveIdentityColorName` is the existing hash; its array order is
// load-bearing upstream, which is a second reason not to invent a third palette.
import {
  deriveIdentityColorName,
  identityColor,
  type IdentityColorName,
} from "@/styles/identity-colors";

export interface ProjectAvatar {
  /** One glyph centred on the tile. "?" only when the name has no usable character. */
  initial: string;
  /** Palette slot, exposed so a caller can key a pre-computed fill style. */
  colorName: IdentityColorName;
  /** Fill hex — the identity palette's band, identical in light and dark. */
  color: string;
}

/** A name with nothing to show still gets a tile; an absent glyph would collapse the row. */
const FALLBACK_INITIAL = "?";

/** Han is the script the user's projects are actually named in (「工作台」→「工」). */
const HAN = /\p{Script=Han}/u;

/**
 * The tile glyph: a Han character whole, anything else its uppercased first code
 * point. Destructuring (not `charAt`) walks code points, so an astral first
 * character yields one glyph instead of a split surrogate pair.
 */
export function projectInitial(projectName: string): string {
  const trimmed = projectName.trim();
  if (trimmed.length === 0) return FALLBACK_INITIAL;
  const [first] = trimmed;
  if (first === undefined) return FALLBACK_INITIAL;
  return HAN.test(first) ? first : first.toLocaleUpperCase();
}

/**
 * Deterministic project tile. The hash runs over the TRIMMED name so a host that
 * pads a project name does not recolour it; the glyph trims the same way.
 */
export function projectAvatarFor(projectName: string): ProjectAvatar {
  const colorName = deriveIdentityColorName(projectName.trim());
  return { initial: projectInitial(projectName), colorName, color: identityColor(colorName) };
}
