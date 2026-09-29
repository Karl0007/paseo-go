// C20 (DESIGN §14.4): the pure arbitration state machine behind
// useShellRowDragMenu. The ruling: a stationary hold decides the anchored menu
// window; if the SAME finger then moves past the relay slop, the touch
// closes/withholds the window and hands over to the row drag — one continuous
// gesture stream, never a second long press.
// The machine speaks in DECISIONS, not pixels: `menu_open` means "the window
// decision is made". Since KI-11 the actuator shows the window AT that instant
// — the surface moved into the app window (the shell-hosted popover in
// chat-row-menu.tsx), so the row's touch stream survives the open and the
// relay edge fires from a VISIBLE menu: decision + past-relay-slop = close +
// drag, same stream, no dead zone. (Pre-KI-11 the engine's Modal-hosted sheet
// forced a pending-release actuator — see the hook's header for the finding.)
//
// Phases and their timings are the on-device-validated values (C3):
//   pressing → armed      at DRAG_ARM_DELAY_MS (180ms) if within
//                          DRAG_ARM_STATIONARY_SLOP_PX (4px) of the anchor;
//   pressing|armed → menu_open
//                        at CONTEXT_MENU_DELAY_MS (250ms since KI-16 — the
//                        shell's OWN decision constant, see the note at its
//                        definition: no shared source with the engine/RN
//                        defaults) if within
//                        CONTEXT_MENU_STATIONARY_SLOP_PX (6px);
//   menu_open → dragging   once the finger is more than
//                          MENU_TO_DRAG_RELAY_SLOP_PX (8px) from the anchor —
//                          the C20 relay edge.
//
// Why 4 < 6 < 8: the arm slop is the strictest because arming only *enables*
// a drag — a mis-arm is invisible to the user. The menu slop is looser because
// opening the window is a visible commitment. The relay must strictly exceed
// the menu slop (a finger that drifted 6px at t=250ms legitimately decided the
// window; that same drift must not snatch it back) AND beat the list's own
// gesture steal. The card ruled 10px; the MatePad measured the steal: a
// continued slide after the decision reached the row only up to ~10px before
// the ScrollView terminated the press (window appeared on the forced press_out
// while the finger was still down — evidence/C20/10-12). The list provably
// does NOT steal below 8px (C3: the armed path's 8px drag slop always won),
// so the relay rides that same measured-safe threshold. Timing conflict
// reported per card; this is the minimal adjustment.
// 8px is also decideLongPressMove's own drag slop, so the armed path and the
// relay share one "the finger clearly means to drag" threshold.
//
// Pre-arm and armed movement decisions delegate to the official sidebar
// arbitration function, so scroll takeover, swipe takeover and tap-cancel keep
// byte-identical semantics with the upstream hook; this module adds the
// menu_open phase, the relay edge, and terminal phases (a `list_owns` touch
// never flips back — the upstream flag soup could re-arm mid-gesture, this
// machine cannot).
import { decideLongPressMove } from "@/utils/sidebar-gesture-arbitration";

export const DRAG_ARM_DELAY_MS = 180;
export const DRAG_ARM_STATIONARY_SLOP_PX = 4;
// The shell's OWN menu-open decision window. KI-16 (user ruling 2026-09-30,
// 「时间先砍半」): halved 500→250. The archived/search Pressable path now
// receives THIS constant explicitly (chat-list-row.tsx passes it as the
// trigger's longPressDelayMs), so the old "coincidence 500" — React Native's
// internal default merely matching us — is gone: one source of truth for both
// row families. Still no shared source with the engine or the official sidebar
// arm (450 in use-long-press-drag-interaction.ts); move it only with new
// on-device data or a new user ruling, never to "align" it with an upstream
// default (R2-24). Arm stays 180: the ladder 180 < 250 keeps arming
// observable before the window decision.
export const CONTEXT_MENU_DELAY_MS = 250;
export const CONTEXT_MENU_STATIONARY_SLOP_PX = 6;
// Card value was 10; lowered to the armed path's 8 after the on-device steal
// measurement above. 8 still strictly exceeds the 6px menu slop.
export const MENU_TO_DRAG_RELAY_SLOP_PX = 8;

export type RowGesturePhase =
  /** No live touch. */
  | "idle"
  /** Finger down, before either timer fired. */
  | "pressing"
  /** 180ms stationary: a clear move now starts the drag. */
  | "armed"
  /** The menu is open — since KI-11 literally visible at the threshold (the
   * actuator's surface lives in the app window); the finger may still hold. */
  | "menu_open"
  /** drag() has fired for this touch — it must never fire again. */
  | "dragging"
  /** Scroll/swipe/cancel took the gesture before arm. Terminal. */
  | "list_owns";

export interface RowGestureState {
  phase: RowGesturePhase;
  /**
   * True when the row must swallow the onPress that follows this touch stream
   * (menu opened, drag started, or the list took the gesture with a dominant
   * direction). Survives `press_out`; reset by the next `press_in`.
   */
  didLongPress: boolean;
}

export type RowGestureEvent =
  | { type: "press_in" }
  /** The 180ms arm timer fired; `distance` is from the anchor at that instant. */
  | { type: "arm_tick"; distance: number }
  /** The 250ms menu timer fired; `distance` is from the anchor at that instant. */
  | { type: "menu_tick"; distance: number }
  /** Finger moved; deltas are from the anchor (the menu anchors at the press point). */
  | { type: "touch_move"; dx: number; dy: number }
  | { type: "press_out" }
  /**
   * R2-01: the list's drop handler landing OUT OF BAND. Once `drag()` has
   * fired, RNGH owns the touch natively and the JS press_out never arrives
   * (the hook's header documents the takeover), so the machine needs the
   * drag lifecycle's own end event to leave `dragging` — otherwise the
   * screen's scroll lock is stranded for the rest of the session.
   */
  | { type: "drag_end" };

export type RowGestureEffect =
  | "haptic_arm"
  | "open_menu"
  | "haptic_menu"
  | "close_menu"
  | "haptic_drag"
  | "start_drag";

export interface RowGestureStep {
  state: RowGestureState;
  /**
   * Effects to apply in order, synchronously, in the caller's frame. The relay
   * step deliberately carries `close_menu` before `start_drag` in ONE step so
   * the window is dismissed and the row lifted without an intervening render.
   */
  effects: readonly RowGestureEffect[];
}

export const IDLE_ROW_GESTURE_STATE: RowGestureState = {
  phase: "idle",
  didLongPress: false,
};

const NO_EFFECTS: readonly RowGestureEffect[] = [];

export function stepRowGesture(state: RowGestureState, event: RowGestureEvent): RowGestureStep {
  switch (event.type) {
    case "press_in":
      // A new touch always owns the machine; didLongPress resets so a plain tap
      // after a previous menu/drag still opens the row.
      return { state: { phase: "pressing", didLongPress: false }, effects: NO_EFFECTS };

    case "arm_tick":
      if (state.phase !== "pressing" || event.distance > DRAG_ARM_STATIONARY_SLOP_PX) {
        return { state, effects: NO_EFFECTS };
      }
      return {
        state: { phase: "armed", didLongPress: state.didLongPress },
        effects: ["haptic_arm"],
      };

    case "menu_tick":
      if (
        (state.phase !== "pressing" && state.phase !== "armed") ||
        event.distance > CONTEXT_MENU_STATIONARY_SLOP_PX
      ) {
        return { state, effects: NO_EFFECTS };
      }
      return {
        state: { phase: "menu_open", didLongPress: true },
        effects: ["open_menu", "haptic_menu"],
      };

    case "touch_move":
      return stepTouchMove(state, event.dx, event.dy);

    case "press_out":
      // didLongPress survives the reset so the row's onPress can read it.
      return { state: { phase: "idle", didLongPress: state.didLongPress }, effects: NO_EFFECTS };

    case "drag_end":
      // Only a touch that actually lifted the row has a drag to end. From any
      // other phase a stray drop must be inert — it must never kill a live
      // press/arm/menu gesture. Exits exactly like press_out: idle, with the
      // swallow flag surviving for the row's onPress.
      if (state.phase !== "dragging") return { state, effects: NO_EFFECTS };
      return { state: { phase: "idle", didLongPress: state.didLongPress }, effects: NO_EFFECTS };
  }
}

// The movement edges of the machine (kept out of stepRowGesture so the event
// router stays readable): the C20 relay from menu_open, and the pre-arm/armed
// decisions delegated to the official sidebar arbitration function.
function stepTouchMove(state: RowGestureState, dx: number, dy: number): RowGestureStep {
  if (state.phase === "menu_open") {
    const distance = Math.hypot(dx, dy);
    if (distance <= MENU_TO_DRAG_RELAY_SLOP_PX) return { state, effects: NO_EFFECTS };
    // The C20 relay: close the window and lift the row in the same
    // synchronous step — the card demands one touch stream, no re-press.
    return {
      state: { phase: "dragging", didLongPress: true },
      effects: ["close_menu", "haptic_drag", "start_drag"],
    };
  }
  if (state.phase !== "pressing" && state.phase !== "armed") {
    return { state, effects: NO_EFFECTS };
  }
  const decision = decideLongPressMove({
    dragArmed: state.phase === "armed",
    didStartDrag: false,
    startPoint: { x: 0, y: 0 },
    currentPoint: { x: dx, y: dy },
  });
  switch (decision) {
    case "start_drag":
      return {
        state: { phase: "dragging", didLongPress: true },
        effects: ["haptic_drag", "start_drag"],
      };
    case "vertical_scroll":
    case "horizontal_swipe":
      // The list (or a swipe) owns the gesture; no menu may follow this
      // touch, and the press is swallowed (the finger clearly meant to move).
      return { state: { phase: "list_owns", didLongPress: true }, effects: NO_EFFECTS };
    case "cancel_long_press":
      // Moved past the cancel slop with no dominant direction before arm:
      // no menu follows, but the press is NOT swallowed — RN's own press
      // slop has usually already killed the tap, and swallowing here would
      // eat legitimate taps on the edge of the slop.
      return { state: { phase: "list_owns", didLongPress: false }, effects: NO_EFFECTS };
    default:
      return { state, effects: NO_EFFECTS };
  }
}
