// C21 shell edge-back gesture — the pure half: the direction lock that decides
// whether a drag starting inside the left-edge band is a 返回 swipe, a vertical
// scroll the session keeps, or still undecided. It mirrors the official
// `resolveMobilePanelGestureIntent` shape (activate/fail/wait under manual
// activation) so both arbiters read the same way; the card's ruling is the
// threshold set: horizontal activation distance for 返回, vertical escape to
// the scroll view, and a leftward drag that is simply not ours.
//
// The band itself lives in `use-shell-edge-back-gesture`; the official
// left-open / right-open gestures are parked for the capsule's whole visible
// span via the provider's symbol-keyed `setOpenGestureBlocked` (released on
// unmount), so no official panel can race the swipe.

export type ShellEdgeSwipeIntent = "back" | "fail" | "wait";

/** Width of the transparent left-edge band, dp (card C21: ≈32px). */
export const SHELL_EDGE_BAND_WIDTH_DP = 32;

/**
 * Left-edge band gate — dp against dp. RNGH hands `absoluteX` already converted
 * to density-independent units (Android: `PixelUtil.toDIPFromPixel` in
 * `GestureHandler.kt`; iOS: points), so the start-x limit must NOT be scaled by
 * `PixelRatio.get()`: that compared 32 × density against a dp coordinate and
 * opened the band to 80dp on a 2.5-density device, stealing session drags that
 * start well inside the screen.
 */
export function isInsideShellEdgeBand(startXDp: number): boolean {
  "worklet";
  return startXDp <= SHELL_EDGE_BAND_WIDTH_DP;
}

/** Rightward travel that commits the swipe to 返回, dp. */
export const SHELL_EDGE_BACK_ACTIVATE_DP = 24;

/** Travel past which the OTHER axis owns the drag, dp (official intent's value). */
const ESCAPE_DP = 10;

export function resolveShellEdgeSwipeIntent(input: {
  deltaX: number;
  deltaY: number;
}): ShellEdgeSwipeIntent {
  "worklet";
  const absDeltaX = Math.abs(input.deltaX);
  const absDeltaY = Math.abs(input.deltaY);
  // Leftward: the official close-gesture direction, never a back.
  if (input.deltaX <= -ESCAPE_DP) return "fail";
  // Vertical lead: hand the stream to the session's scroll views.
  if (absDeltaY > ESCAPE_DP && absDeltaY > absDeltaX) return "fail";
  // Horizontal lock: rightward, past the threshold, and the dominant axis.
  if (input.deltaX >= SHELL_EDGE_BACK_ACTIVATE_DP && absDeltaX >= absDeltaY) return "back";
  return "wait";
}
