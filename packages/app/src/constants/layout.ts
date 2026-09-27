import { useWindowDimensions } from "react-native";
import { isWeb } from "@/constants/platform";

export const FOOTER_HEIGHT = 75;

// Shared header inner height (excluding safe area insets and border)
// Used by both agent header (ScreenHeader) and explorer sidebar header
// This ensures both headers have the same visual height
export const HEADER_INNER_HEIGHT = 36;
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36;
export const HEADER_TOP_PADDING_MOBILE = 8;

// Max width for chat content (stream view, input area, new agent form)
export const MAX_CONTENT_WIDTH = 820;
export const COMPACT_FORM_FACTOR_WIDTH = 500;

// Settings uses the canonical desktop list + detail layout. Its sidebar and
// detail target must fit together before it can share width with app navigation.
export const SETTINGS_DESKTOP_SIDEBAR_WIDTH = 320;
export const SETTINGS_DESKTOP_DETAIL_MIN_WIDTH = 400;
export const SETTINGS_DESKTOP_SPLIT_MIN_WIDTH =
  SETTINGS_DESKTOP_SIDEBAR_WIDTH + SETTINGS_DESKTOP_DETAIL_MIN_WIDTH;

// Desktop app constants for macOS traffic light buttons
// These buttons (close/minimize/maximize) overlay the top-left corner
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 78;
export const DESKTOP_TRAFFIC_LIGHT_HEIGHT = 45;

// Custom desktop window controls (minimize/maximize/close) — top-right
export const DESKTOP_WINDOW_CONTROLS_HEIGHT = HEADER_INNER_HEIGHT;

export {
  getIsElectron as getIsElectronRuntime,
  getIsElectronMac as getIsElectronRuntimeMac,
} from "./platform";

/**
 * Reactive hook — re-renders the component when the compact/wide form factor
 * changes. Always use this instead of reading UnistylesRuntime.breakpoint directly.
 *
 * COMPAT(shellFormFactorRotation): upstream touchpoint #8 (paseo-go fork,
 * 2026-09-28). Unistyles' breakpoint subscription does NOT fire on a runtime
 * device rotation — Fabric re-layouts natively while the JS `rt.breakpoint`
 * stays stale (device evidence C31-F1), so every consumer of this hook kept
 * phone chrome in a landscape window. The REVIEW2 R2-04 ruling (2a) moves the
 * source to the RN-core `useWindowDimensions()` subscription (Dimensions change
 * event — rotates in both directions). The threshold is the Unistyles table's
 * md floor INLINED because official files must not import the shell mirror
 * (`src/shell/tablet/form-factor.ts`): truth = `styles/unistyles.ts` breakpoints
 * (xs|sm ⇔ width < 720), machine-pinned against the table by
 * `src/shell/tablet/form-factor.test.ts` (R2-11 gate, extended for this file).
 * known_issue (R2-11 family): window width vs Unistyles' own subscription only
 * diverge under Android ≤10 free-form multi-window — there the window face is
 * the rotation-correct one, deliberately chosen.
 */
const COMPACT_FORM_FACTOR_MAX_WIDTH = 720;

export function useIsCompactFormFactor(): boolean {
  const { width } = useWindowDimensions();
  return width < COMPACT_FORM_FACTOR_MAX_WIDTH;
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}
