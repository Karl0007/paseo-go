import { Platform } from "react-native";
import { darkHighlightColors, lightHighlightColors } from "@getpaseo/highlight";

export const baseColors = {
  // Base colors
  white: "#ffffff",
  black: "#000000",

  // Zinc scale (primary gray palette)
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1a1a1d",
    900: "#18181b",
    950: "#121214",
  },

  // Gray scale
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },

  // Slate scale
  slate: {
    200: "#e2e8f0",
  },

  // Blue scale
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },

  // Green scale
  green: {
    100: "#dcfce7",
    200: "#bbf7d0",
    400: "#4ade80",
    500: "#22c55e",
    600: "#16a34a",
    800: "#166534",
    900: "#14532d",
  },

  // Red scale
  red: {
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    500: "#ef4444",
    600: "#dc2626",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Teal scale
  teal: {
    200: "#99f6e4",
  },

  // Amber scale
  amber: {
    500: "#f59e0b",
    700: "#b45309",
  },

  // Yellow scale
  yellow: {
    400: "#fbbf24",
  },

  // Purple scale
  purple: {
    500: "#a855f7",
    600: "#9333ea",
  },

  // Orange scale
  orange: {
    500: "#f97316",
    600: "#ea580c",
  },
} as const;

// Diff colors — the +/- inside a diff view, where the color *is* the signal and has to
// survive being scanned line by line, so it stays saturated. Light uses muted tones, dark
// uses the brighter palette values.
//
// A diff *stat* — the "+12 −3" footnote next to a title — is not this. It is a status
// signal, so it uses statusSuccess/statusDanger below rather than a tier of its own.
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 — readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
};

// Status colors — semantic signals for success/danger/warning/merged. There is exactly one
// token per signal, and every status surface uses it: PR state icons, CI check icons and
// pies, diff stats, file-change icons, status badges, usage bars. Status *dots* are the
// exception and have their own band below. A surface does not otherwise get a quieter or
// louder variant of a status color because of where it sits — if a dense list feels loud,
// that is a density or weight problem, not a color problem.
//
// The level is set by the densest consumer, the sidebar workspace list: quiet enough that a
// column of green checks reads as one line of subtitle and the single red row still stands
// out, saturated enough to name the state on its own. Every other surface follows it.
//
// Normalized, not hand-picked. Every color below shares one lightness and one chroma; only
// the hue changes, and each hue is the one that family already had. Chroma is a fixed
// fraction of what sRGB allows at that lightness and hue, because the gamut is lopsided —
// amber runs out of room long before red does, so a literal equal-chroma set leaves amber
// flat and red screaming. Equal fractions is what makes four hues read as one family.
// Regenerate with the same rule rather than nudging one value.
//
// Hues are fixed per family across both themes: success 150, danger 27, warning 70.5,
// merged 300 — plus one achromatic member, `statusNeutral`: the state with no hue to
// wear (the ownership pill's 未知, REVIEW-B8-10 裁定 D6).
const lightStatusColors = {
  // L=0.50, chroma 60% of gamut max
  statusSuccess: "#3e704a",
  statusDanger: "#9d433b",
  statusWarning: "#7b5d39",
  statusMerged: "#7347af",
  // A gray at the family's L=0.50 reaches only ~3.9:1 on its own tint — under AA, and
  // a word one must read is not a dot one may skip. The neutral text takes the band's
  // zinc-600 step (6.4:1 on its tint); the tint itself keeps the family's alpha, so
  // the fill reads at the siblings' strength (1.20 vs their 1.18/1.19 on the row).
  statusNeutral: "#52525b",
};

const darkStatusColors = {
  // L=0.70, chroma 55% of gamut max
  statusSuccess: "#6cb17b",
  statusDanger: "#d8847b",
  statusWarning: "#c09664",
  statusMerged: "#a890d5",
  // The achromatic sibling: zinc-400, at the band's lightness (5.1:1 on its tint,
  // fill 1.32 vs the siblings' 1.30/1.31 on the default dark row).
  statusNeutral: "#a1a1aa",
};

// Status tints — the fill of a status badge. The status color itself at low opacity, so a
// badge takes its state's hue from the same source as its text and never drifts from it.
// Dark surfaces swallow more of the tint, so the dark band runs a little stronger.
//
// The alpha is not a constant the variants inherit: it is solved per (surface0, status
// pair). A badge's three colors sit on one luminance line — row, fill, word — and contrast
// multiplies along it:
//
//   contrast(word, row) = contrast(word, fill) × contrast(fill, row)
//
// so the two floors are not two knobs. Pushing the fill off the row (1.15 — REVIEW-B8-10
// 裁定 D6: a pill must still read as a pill) drags it toward its own word, and the word's
// AA floor (4.5 at fontSize.sm) is what stops it. Their product, 5.175, is the minimum span
// a row owes the pair. The band alpha was only ever verified against the two primary rows.
// ghostty's surface0 (#282c34) is the brightest row in the catalog: the neutral pair has a
// span of 5.46 there, and the inherited 16% spent so much of it on the fill that the 未知
// word read 4.12:1 — no band-wide constant could have said otherwise, which is why the fix
// is a solve and not a new number (REVIEW-B9-09 裁定 A).
//
// The authored band alpha stays the CAP. A pair that already clears both floors keeps it
// byte for byte — six of the seven built-in themes ship exactly what they shipped before —
// and a pair that does not gets the middle of its own window, never a value above the band.
// A pair with no landing at all takes the AA floor and lets the fill go as strong as the
// word allows: a word one must read outranks a fill one may skip. Two kinds of "no
// landing": statusDanger on ghostty never had the span (5.00 < 5.175), and statusWarning
// clears the span by 0.3% but not by an achievable step — the composite rounds to 8 bits,
// so the fill moves 1.1451 → 1.1610 and the window 1.1500–1.1538 has no rung in it. Both
// land on the AA floor (warning 3.99 → 4.52) and the 外部 pill's fill stops at 1.145 on
// that row — pinned where it is measured, not where it wishes, in ownership-badge.test.tsx.
const STATUS_WORD_FLOOR = 4.5;
const STATUS_FILL_FLOOR = 1.15;
const LIGHT_STATUS_TINT_ALPHA = "1f"; // 12%
const DARK_STATUS_TINT_ALPHA = "29"; // 16%

type Rgb = number[];

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → channels; anything else → null (never a guess). */
function hexChannels(color: string): Rgb | null {
  const digits = color.replace("#", "");
  const hex =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  if (!/^[0-9a-fA-F]{6}/.test(hex)) return null;
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

function channelLinear(byte: number): number {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(channels: Rgb): number {
  return (
    0.2126 * channelLinear(channels[0] ?? 0) +
    0.7152 * channelLinear(channels[1] ?? 0) +
    0.0722 * channelLinear(channels[2] ?? 0)
  );
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** What the row actually shows through an 8-bit-alpha fill (same rounding a compositor does). */
function compositeOverRow(tint: Rgb, alpha: number, row: Rgb): Rgb {
  const mix = (i: number) => Math.round(alpha * (tint[i] ?? 0) + (1 - alpha) * (row[i] ?? 0));
  return [mix(0), mix(1), mix(2)];
}

/**
 * The tint's alpha as a number in [0,1]: the authored band value when that value clears
 * both floors on this row, the middle of the feasible window when it does not, and the
 * word floor's ceiling when the window is empty.
 *
 * Both floors are monotone in alpha here — the fill is the word's own color, so raising
 * alpha walks the fill from the row toward the word and never past it: fill/row can only
 * grow, word/fill can only shrink. That is what makes a bisection the whole solve.
 */
function solveStatusTintAlpha(
  wordOK: (alpha: number) => boolean,
  fillOK: (alpha: number) => boolean,
  authored: number,
): number {
  if (!wordOK(0)) return 0; // The row alone already fails AA; a stronger fill only lies.
  let capLo = 0;
  let capHi = 1;
  if (!wordOK(1)) {
    for (let i = 0; i < 60; i += 1) {
      const mid = (capLo + capHi) / 2;
      if (wordOK(mid)) capLo = mid;
      else capHi = mid;
    }
  }
  const cap = wordOK(1) ? 1 : capLo;
  let floor = 0;
  if (!fillOK(0)) {
    if (fillOK(1)) {
      let floorLo = 0;
      let floorHi = 1;
      for (let i = 0; i < 60; i += 1) {
        const mid = (floorLo + floorHi) / 2;
        if (fillOK(mid)) floorHi = mid;
        else floorLo = mid;
      }
      floor = floorHi;
    } else {
      floor = 1;
    }
  }
  if (floor > cap) return cap;
  if (authored >= floor && authored <= cap) return authored;
  return (floor + cap) / 2;
}

/**
 * One badge fill: the status color over `surface0` at the alpha this row can carry.
 * Stays an 8-digit hex whenever a whole alpha byte holds both floors (the band's shape);
 * only a window narrower than one byte of alpha writes itself out as rgba — and then the
 * alpha is truncated, never rounded up, because rounding up walks past the AA floor the
 * value was solved for.
 */
function statusTintToken(color: string, surface0: string, authoredAlphaHex: string): string {
  const channels = hexChannels(color);
  const row = hexChannels(surface0);
  const authored = Number.parseInt(authoredAlphaHex, 16) / 255;
  // 解析不了的输入（插件给的怪串）不参与求解：照发 band 的写法，绝不因求解改色。
  if (!channels || !row || !Number.isFinite(authored)) return `${color}${authoredAlphaHex}`;
  const fillAt = (alpha: number) => compositeOverRow(channels, alpha, row);
  const wordOK = (alpha: number) => contrastRatio(channels, fillAt(alpha)) >= STATUS_WORD_FLOOR;
  const fillOK = (alpha: number) => contrastRatio(fillAt(alpha), row) >= STATUS_FILL_FLOOR;
  const alpha = solveStatusTintAlpha(wordOK, fillOK, authored);
  const byte = Math.min(255, Math.round(alpha * 255));
  if (wordOK(byte / 255) && fillOK(byte / 255)) {
    return `${color}${byte.toString(16).padStart(2, "0")}`;
  }
  const truncated = Math.floor(alpha * 1e6) / 1e6;
  const [r = 0, g = 0, b = 0] = channels;
  return `rgba(${r}, ${g}, ${b}, ${truncated.toFixed(6)})`;
}

function statusTints(colors: typeof lightStatusColors, surface0: string, alphaHex: string) {
  return {
    statusSuccessTint: statusTintToken(colors.statusSuccess, surface0, alphaHex),
    statusDangerTint: statusTintToken(colors.statusDanger, surface0, alphaHex),
    statusWarningTint: statusTintToken(colors.statusWarning, surface0, alphaHex),
    statusNeutralTint: statusTintToken(colors.statusNeutral, surface0, alphaHex),
  };
}

// Status *dot* colors — the small filled discs on a sidebar row, and the glyphs that stand in
// for them. Same four hues and the same generation rule as the status colors above, but its
// own band, because a dot is doing a different job than a check icon or a host badge.
//
// A dot is 6pt of solid color with no shape to read and no label attached. At the status
// band's lightness the dots read dimmer than the static text and icons beside them on the same
// row, which is backwards — the dot is the row's state. The loudness comes from chroma: 90% of
// gamut max against the status family's 55-60%.
//
// Lightness is set by hue separation, not by distance from the surface. A dark dot on a light
// surface has plenty of contrast but the four hues collapse into each other at 6pt — dark green,
// dark red, dark amber and dark blue all read as "dark blob", and the point of the dot is telling
// them apart at a glance. So the light band runs as bright as the contrast floor allows: L=0.62
// is the last step where all four clear 3:1 against the sidebar's surface2 (success is the
// binding one at 3.10, and drops under 3 by L=0.64), which is WCAG's non-text minimum for a
// control that carries state.
//
// All four move together. A dot matching its siblings in lightness and chroma says only which
// state the row is in; one that does not says "this row matters more", which is a claim the
// color has no business making. Regenerate the set, never one hue.
//
// 90% and not 100%: at the gamut edge the lopsidedness is worst — green reaches C=0.215 while
// blue manages 0.116 — so the set stops reading as one family and green wins. Red running out
// of chroma as lightness climbs is what caps the dark band at L=0.72; higher turns the failed
// dot pink, and the light band pastels out the same way just above its own cap. Running is blue
// at hue 250, clear of
// identity-colors' blue at 256.6 so a blue host badge and a working dot on the same row do not
// read as related.
const lightStatusDotColors = {
  // L=0.62, chroma 90% of gamut max
  statusDotSuccess: "#299f51",
  statusDotDanger: "#f12e2f",
  statusDotWarning: "#b37824",
  statusDotRunning: "#268ae0",
};

const darkStatusDotColors = {
  // L=0.72, chroma 90% of gamut max
  statusDotSuccess: "#35c264",
  statusDotDanger: "#f7796d",
  statusDotWarning: "#db932e",
  statusDotRunning: "#5caaf6",
};

export interface LightThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  foreground: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  terminalBlack: string;
  terminalBrightBlack: string;
  ring: string;
}

const lightTerminalAnsi = {
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#ffffff",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#f59e0b",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#fafafa",
} as const;

export function buildLightSemanticColors(tint: LightThemeConfig) {
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surface1,
    surfaceSidebarSelected: tint.surface3,
    surfaceWorkspace: tint.surface0,
    interactionHighlight: "rgba(0, 0, 0, 0.06)",

    foreground: tint.foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: tint.foregroundExtraMuted,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? tint.surface0,

    destructive: tint.destructive,
    destructiveForeground: tint.surface0,
    success: tint.accent,
    successForeground: tint.surface0,

    background: tint.surface0,
    popover: tint.surface0,
    popoverForeground: tint.foreground,
    primary: tint.primary,
    primaryForeground: tint.primaryForeground,
    secondary: tint.surface2,
    secondaryForeground: tint.foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: tint.ring,

    ...lightDiffColors,
    ...lightStatusColors,
    // 逐主题求解：tint 的 alpha 按这一份 surface0 反算，不共用一个常数。
    ...statusTints(lightStatusColors, tint.surface0, LIGHT_STATUS_TINT_ALPHA),
    ...lightStatusDotColors,

    terminal: {
      background: tint.surface0,
      foreground: tint.foreground,
      cursor: tint.foreground,
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(0, 0, 0, 0.15)",
      selectionForeground: tint.foreground,
      black: tint.terminalBlack,
      ...lightTerminalAnsi,
      brightBlack: tint.terminalBrightBlack,
    },
  };
}

const lightSemanticColors = buildLightSemanticColors({
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  surface3: "#e4e4e7",
  surface4: "#d4d4d8",
  surfaceDiffEmpty: "#f6f6f6",
  surfaceSidebar: "#f4f4f5",
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  foregroundExtraMuted: "#a1a1aa",
  border: "#e4e4e7",
  borderAccent: "#ececf1",
  accent: "#20744A",
  accentBright: "#239956",
  accentForeground: "#ffffff",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  destructive: "#b04138",
  terminalBlack: "#1a1a1e",
  terminalBrightBlack: "#3f3f46",
  ring: "#18181b",
});

// ---------------------------------------------------------------------------
// Dark theme variant builder
// ---------------------------------------------------------------------------

export interface DarkThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  destructive: string;
  terminalBlack: string;
  terminalBrightBlack: string;
  foreground?: string;
  ring?: string;
}

const darkTerminalAnsi = {
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#b07ad0",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#c49ae0",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

export function buildDarkSemanticColors(tint: DarkThemeConfig) {
  const foreground = tint.foreground ?? "#fafafa";
  const ring = tint.ring ?? "#d4d4d8";
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surface1,
    surfaceSidebarSelected: tint.surface2,
    surfaceWorkspace: tint.surface1,
    interactionHighlight: "rgba(255, 255, 255, 0.08)",

    foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: tint.foregroundExtraMuted,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? "#ffffff",

    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: foreground,
    primary: foreground,
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring,

    ...darkDiffColors,
    ...darkStatusColors,
    // 逐主题求解：变体的 surface0 越亮，同一档 alpha 越吃字下限（REVIEW-B9-09）。
    ...statusTints(darkStatusColors, tint.surface0, DARK_STATUS_TINT_ALPHA),
    ...darkStatusDotColors,

    terminal: {
      background: tint.surface0,
      foreground,
      cursor: foreground,
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: foreground,
      black: tint.terminalBlack,
      ...darkTerminalAnsi,
      brightBlack: tint.terminalBrightBlack,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions
// ---------------------------------------------------------------------------

// Paseo — subtle teal-green tint (default)
const paseoDarkColors = buildDarkSemanticColors({
  surface0: "#181B1A",
  surface1: "#1E2120",
  surface2: "#272A29",
  surface3: "#434645",
  surface4: "#595B5B",
  surfaceDiffEmpty: "#252827",
  surfaceSidebar: "#141716",
  foregroundMuted: "#A1A5A4",
  foregroundExtraMuted: "#717574",
  border: "#252B2A",
  borderAccent: "#2F3534",
  accent: "#20744A",
  accentBright: "#7ccba0",
  destructive: "#c64f43", // warm red, hue ~7 — reads as red (not pink) against the green tint
  terminalBlack: "#141716",
  terminalBrightBlack: "#434645",
});

// Zinc — neutral gray, no tint
const zincDarkColors = buildDarkSemanticColors({
  surface0: "#18181b",
  surface1: "#1f1f22",
  surface2: "#27272a",
  surface3: "#3f3f46",
  surface4: "#52525b",
  surfaceDiffEmpty: "#242427",
  surfaceSidebar: "#131316",
  foregroundMuted: "#a1a1aa",
  foregroundExtraMuted: "#71717a",
  border: "#27272a",
  borderAccent: "#303036",
  accent: "#e4e4e7",
  accentBright: "#fafafa",
  accentForeground: "#18181b", // monochrome zinc accent is near-white — needs dark text
  destructive: "#c44a4a", // neutral red, hue 0 — clearly red without screaming
  terminalBlack: "#131316",
  terminalBrightBlack: "#3f3f46",
});

// Midnight — subtle blue tint
const midnightDarkColors = buildDarkSemanticColors({
  surface0: "#161820",
  surface1: "#1c1e27",
  surface2: "#252731",
  surface3: "#3c3e4c",
  surface4: "#535564",
  surfaceDiffEmpty: "#222430",
  surfaceSidebar: "#121420",
  foregroundMuted: "#9a9db0",
  foregroundExtraMuted: "#6b6e82",
  border: "#242636",
  borderAccent: "#2e3040",
  accent: "#3b6fcf",
  accentBright: "#7eaaeb",
  destructive: "#c44a52", // red with a hint of cool lean against the blue tint
  terminalBlack: "#121420",
  terminalBrightBlack: "#3c3e4c",
});

// Claude — warm neutral with subtle orange undertone
const claudeDarkColors = buildDarkSemanticColors({
  surface0: "#1f1f1e",
  surface1: "#262523",
  surface2: "#2f2d2b",
  surface3: "#4a4745",
  surface4: "#605d5b",
  surfaceDiffEmpty: "#2a2826",
  surfaceSidebar: "#1a1918",
  foregroundMuted: "#ada9a5",
  foregroundExtraMuted: "#78746f",
  border: "#2c2a27",
  borderAccent: "#36332f",
  accent: "#d97757",
  accentBright: "#e89a7f",
  destructive: "#cf513e", // warm orange-red, hue ~10 — sits with the Claude orange accent
  terminalBlack: "#1a1918",
  terminalBrightBlack: "#4a4745",
});

// Ghostty — blue-tinted dark based on Ghostty default background
const ghosttyDarkColors = buildDarkSemanticColors({
  surface0: "#282c34",
  surface1: "#2f333d",
  surface2: "#383c48",
  surface3: "#4a4f5e",
  surface4: "#5b6175",
  surfaceDiffEmpty: "#323643",
  surfaceSidebar: "#21252d",
  foregroundMuted: "#c8ccd8",
  foregroundExtraMuted: "#a0a4b2",
  border: "#353a47",
  borderAccent: "#3f4454",
  accent: "#89b4fa",
  accentBright: "#b4d0fc",
  destructive: "#c44a55", // red with slight cool lean against the slate-blue surfaces
  terminalBlack: "#21252d",
  terminalBrightBlack: "#4a4f5e",
});

export const SPACING = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export const FONT_SIZE = {
  code: 12,
  content: 15,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 18,
  "2xl": 20,
  "3xl": 22,
  "4xl": 26,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
} as const;

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

export const FONT_WEIGHT = {
  normal: "normal" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "bold" as const,
} as const;

export const BORDER_RADIUS = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;

export const BORDER_WIDTH = {
  0: 0,
  1: 1,
  2: 2,
} as const;

export const OPACITY = {
  0: 0,
  50: 0.5,
  100: 1,
} as const;

// Platform default font stacks — copied verbatim from constants/theme.ts `Fonts`
// (sans -> ui, mono -> mono). These seed the dynamic `fontFamily` theme token and
// are the fallback an empty user-supplied family resolves to at apply time.
export const DEFAULT_UI_FONT_STACK: string = Platform.select({
  ios: "system-ui",
  default: "normal",
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});

export const DEFAULT_MONO_FONT_STACK: string = Platform.select({
  ios: "ui-monospace",
  default: "monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// `fontSize`, `fontFamily`, and `lineHeight` are deliberately widened to plain
// `number`/`string` (not narrowed by `as const`) so the appearance updater can patch
// them at runtime via `UnistylesRuntime.updateTheme`. The remaining tokens keep their
// literal types.
interface CommonTheme {
  spacing: typeof SPACING;
  fontSize: Record<keyof typeof FONT_SIZE, number>;
  fontFamily: { ui: string; mono: string };
  lineHeight: Record<keyof typeof LINE_HEIGHT, number>;
  iconSize: typeof ICON_SIZE;
  fontWeight: typeof FONT_WEIGHT;
  borderRadius: typeof BORDER_RADIUS;
  borderWidth: typeof BORDER_WIDTH;
  opacity: typeof OPACITY;
}

const commonTheme: CommonTheme = {
  spacing: SPACING,
  fontSize: FONT_SIZE,
  fontFamily: { ui: DEFAULT_UI_FONT_STACK, mono: DEFAULT_MONO_FONT_STACK },
  lineHeight: LINE_HEIGHT,
  iconSize: ICON_SIZE,
  fontWeight: FONT_WEIGHT,
  borderRadius: BORDER_RADIUS,
  borderWidth: BORDER_WIDTH,
  opacity: OPACITY,
};

const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.25)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.40)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: darkHighlightColors,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(paseoDarkColors);
export const darkZincTheme = buildDarkTheme(zincDarkColors);
export const darkMidnightTheme = buildDarkTheme(midnightDarkColors);
export const darkClaudeTheme = buildDarkTheme(claudeDarkColors);
export const darkGhosttyTheme = buildDarkTheme(ghosttyDarkColors);

// Pure black — zero-luminance background with high-contrast surfaces.
const pureBlackDarkColors = buildDarkSemanticColors({
  surface0: "#000000",
  surface1: "#0a0a0a",
  surface2: "#111111",
  surface3: "#202020",
  surface4: "#2d2d2d",
  surfaceDiffEmpty: "#0c0c0c",
  surfaceSidebar: "#000000",
  foregroundMuted: "#a1a1aa",
  foregroundExtraMuted: "#71717a",
  border: "#1c1c1c",
  borderAccent: "#242424",
  accent: "#20744A",
  accentBright: "#7ccba0",
  destructive: "#c44a4a",
  terminalBlack: "#595959",
  terminalBrightBlack: "#8a8a8a",
});

export const darkPureBlackTheme = buildDarkTheme(pureBlackDarkColors);

const lightShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.02)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.04)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.08)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export function buildLightTheme(semanticColors: ReturnType<typeof buildLightSemanticColors>) {
  return {
    colorScheme: "light" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: lightHighlightColors,
    },
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

export const lightTheme = buildLightTheme(lightSemanticColors);

// Keep compatibility with existing code
export const theme = darkTheme;

export const THEME_OPTIONS = [
  {
    name: "light",
    group: "primary",
    unistylesName: "light",
    theme: lightTheme,
    swatch: "#ffffff",
  },
  {
    name: "dark",
    group: "primary",
    unistylesName: "dark",
    theme: darkTheme,
    swatch: "#2D8B62",
  },
  { name: "auto", group: "primary" },
  {
    name: "zinc",
    group: "variant",
    unistylesName: "darkZinc",
    theme: darkZincTheme,
    swatch: "#808080",
  },
  {
    name: "midnight",
    group: "variant",
    unistylesName: "darkMidnight",
    theme: darkMidnightTheme,
    swatch: "#4A6BA8",
  },
  {
    name: "claude",
    group: "variant",
    unistylesName: "darkClaude",
    theme: darkClaudeTheme,
    swatch: "#D97757",
  },
  {
    name: "ghostty",
    group: "variant",
    unistylesName: "darkGhostty",
    theme: darkGhosttyTheme,
    swatch: "#8caaee",
  },
  {
    name: "pureBlack",
    group: "variant",
    unistylesName: "darkPureBlack",
    theme: darkPureBlackTheme,
    swatch: "#000000",
  },
] as const;

export const PLUGIN_THEME_PREFERENCE = "plugin";
export const PLUGIN_THEME_NAMES = {
  light: "pluginLight",
  dark: "pluginDark",
} as const;

export type ThemePreference =
  | (typeof THEME_OPTIONS)[number]["name"]
  | typeof PLUGIN_THEME_PREFERENCE;
export type ThemeName = Exclude<ThemePreference, "auto" | typeof PLUGIN_THEME_PREFERENCE>;
type ConcreteThemeOption = Exclude<(typeof THEME_OPTIONS)[number], { name: "auto" }>;
export type Theme = ConcreteThemeOption["theme"];

const CONCRETE_THEME_OPTIONS = THEME_OPTIONS.filter(
  (option): option is ConcreteThemeOption => option.name !== "auto",
);

type ThemeToUnistyles = {
  [Name in ThemeName]: Extract<ConcreteThemeOption, { name: Name }>["unistylesName"];
};

type ThemeSwatches = {
  [Name in ThemeName]: Extract<ConcreteThemeOption, { name: Name }>["swatch"];
};

type RegisteredThemes = {
  [Option in ConcreteThemeOption as Option["unistylesName"]]: Option["theme"];
} & {
  pluginLight: typeof lightTheme;
  pluginDark: typeof darkTheme;
};

export const THEME_TO_UNISTYLES = Object.fromEntries(
  CONCRETE_THEME_OPTIONS.map((option) => [option.name, option.unistylesName]),
) as ThemeToUnistyles;

export const THEME_SWATCHES = Object.fromEntries(
  CONCRETE_THEME_OPTIONS.map((option) => [option.name, option.swatch]),
) as ThemeSwatches;

export const REGISTERED_THEMES = {
  ...Object.fromEntries(
    CONCRETE_THEME_OPTIONS.map((option) => [option.unistylesName, option.theme]),
  ),
  [PLUGIN_THEME_NAMES.light]: lightTheme,
  [PLUGIN_THEME_NAMES.dark]: darkTheme,
} as RegisteredThemes;

export function getNextThemePreference(current: ThemePreference): ThemePreference {
  const currentIndex = THEME_OPTIONS.findIndex((option) => option.name === current);
  const nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
  return THEME_OPTIONS[nextIndex]?.name ?? THEME_OPTIONS[0].name;
}
