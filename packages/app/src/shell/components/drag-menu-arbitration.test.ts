// C20 acceptance: the full arbitration matrix as a pure state machine — every
// edge the chat-row gesture can take, including the card's named paths
// (press→arm→menu→move→drag relay, menu→tap selection, move-before-arm→scroll)
// and the invariants: drag fires at most once per touch, the relay closes the
// window in the SAME step it lifts the row, and terminal phases never flip back.
import { describe, expect, it } from "vitest";
import {
  CONTEXT_MENU_DELAY_MS,
  CONTEXT_MENU_STATIONARY_SLOP_PX,
  DRAG_ARM_DELAY_MS,
  DRAG_ARM_STATIONARY_SLOP_PX,
  IDLE_ROW_GESTURE_STATE,
  MENU_TO_DRAG_RELAY_SLOP_PX,
  stepRowGesture,
  type RowGestureEvent,
  type RowGestureState,
} from "@/shell/components/drag-menu-arbitration";

function run(events: readonly RowGestureEvent[]): RowGestureState {
  let state: RowGestureState = IDLE_ROW_GESTURE_STATE;
  for (const event of events) state = stepRowGesture(state, event).state;
  return state;
}

const move = (dx: number, dy = 0): RowGestureEvent => ({ type: "touch_move", dx, dy });
const armTick = (distance = 0): RowGestureEvent => ({ type: "arm_tick", distance });
const menuTick = (distance = 0): RowGestureEvent => ({ type: "menu_tick", distance });

describe("drag-menu-arbitration: hold ladder", () => {
  it("press_in owns the machine and clears the long-press swallow flag", () => {
    const step = stepRowGesture({ phase: "idle", didLongPress: true }, { type: "press_in" });
    expect(step.state).toEqual({ phase: "pressing", didLongPress: false });
    expect(step.effects).toEqual([]);
  });

  it("stationary 180ms arms the drag with a selection tick", () => {
    const step = stepRowGesture(run([{ type: "press_in" }]), armTick(DRAG_ARM_STATIONARY_SLOP_PX));
    expect(step.state.phase).toBe("armed");
    expect(step.effects).toEqual(["haptic_arm"]);
  });

  it("drift past the arm slop skips arming but stays pressable", () => {
    const step = stepRowGesture(
      run([{ type: "press_in" }]),
      armTick(DRAG_ARM_STATIONARY_SLOP_PX + 0.1),
    );
    expect(step.state.phase).toBe("pressing");
    expect(step.effects).toEqual([]);
  });

  it("stationary 250ms opens the anchored window from pressing OR armed", () => {
    const fromPressing = stepRowGesture(run([{ type: "press_in" }]), menuTick());
    expect(fromPressing.state).toEqual({ phase: "menu_open", didLongPress: true });
    expect(fromPressing.effects).toEqual(["open_menu", "haptic_menu"]);

    const fromArmed = stepRowGesture(run([{ type: "press_in" }, armTick()]), menuTick());
    expect(fromArmed.state.phase).toBe("menu_open");
    expect(fromArmed.effects).toEqual(["open_menu", "haptic_menu"]);
  });

  it("drift past the menu slop at the menu tick never opens the window", () => {
    const step = stepRowGesture(
      run([{ type: "press_in" }]),
      menuTick(CONTEXT_MENU_STATIONARY_SLOP_PX + 0.1),
    );
    expect(step.state.phase).toBe("pressing");
    expect(step.effects).toEqual([]);
  });

  it("timers that fire after a drag or a takeover are inert", () => {
    const dragged = run([{ type: "press_in" }, armTick(), move(9)]);
    expect(stepRowGesture(dragged, menuTick()).effects).toEqual([]);
    expect(stepRowGesture(dragged, armTick()).effects).toEqual([]);
    const owned = run([{ type: "press_in" }, move(1, 10)]);
    expect(stepRowGesture(owned, menuTick()).effects).toEqual([]);
  });
});

// KI-16 (user ruling 2026-09-30「时间先砍半」): the ladder VALUES are part of
// the contract — the hook arms its timers from these constants, so the machine
// test pins the halved threshold and the arm-before-menu ordering (a menu that
// fires at or before the arm tick would make arming meaningless).
describe("drag-menu-arbitration: timing constants (KI-16)", () => {
  it("menu threshold is the halved 250ms and still trails the 180ms arm", () => {
    expect(CONTEXT_MENU_DELAY_MS).toBe(250);
    expect(DRAG_ARM_DELAY_MS).toBe(180);
    expect(DRAG_ARM_DELAY_MS).toBeLessThan(CONTEXT_MENU_DELAY_MS);
  });
});

describe("drag-menu-arbitration: movement before arm/menu (list wins)", () => {
  it("vertical dominance before arm hands the touch to the scroll", () => {
    const step = stepRowGesture(run([{ type: "press_in" }]), move(1, 10));
    expect(step.state).toEqual({ phase: "list_owns", didLongPress: true });
    expect(step.effects).toEqual([]);
  });

  it("horizontal dominance before arm is a swipe takeover", () => {
    const step = stepRowGesture(run([{ type: "press_in" }]), move(10, 1));
    expect(step.state.phase).toBe("list_owns");
    expect(step.state.didLongPress).toBe(true);
  });

  it("non-directional drift past the cancel slop cancels the long press without eating the tap", () => {
    const step = stepRowGesture(run([{ type: "press_in" }]), move(8, 8));
    expect(step.state).toEqual({ phase: "list_owns", didLongPress: false });
  });

  it("small jitter before arm decides nothing", () => {
    const step = stepRowGesture(run([{ type: "press_in" }]), move(2, 2));
    expect(step.state.phase).toBe("pressing");
    expect(step.effects).toEqual([]);
  });

  it("list_owns is terminal: later moves never arm, drag or open", () => {
    const owned = run([{ type: "press_in" }, move(1, 10)]);
    const after = run([{ type: "press_in" }, move(1, 10), move(40, 0), move(0, 40)]);
    expect(after).toEqual(owned);
  });

  it("armed + clear move starts the drag — dominance no longer matters", () => {
    const step = stepRowGesture(run([{ type: "press_in" }, armTick()]), move(1, 9));
    expect(step.state).toEqual({ phase: "dragging", didLongPress: true });
    expect(step.effects).toEqual(["haptic_drag", "start_drag"]);
  });

  it("armed movement up to the drag slop (8px) does not lift the row", () => {
    const step = stepRowGesture(run([{ type: "press_in" }, armTick()]), move(8));
    expect(step.state.phase).toBe("armed");
    expect(step.effects).toEqual([]);
  });
});

describe("drag-menu-arbitration: C20 menu→drag relay", () => {
  const menuOpen = run([{ type: "press_in" }, armTick(), menuTick()]);

  it("moving past the relay slop closes the window AND lifts the row in ONE step", () => {
    const step = stepRowGesture(menuOpen, move(MENU_TO_DRAG_RELAY_SLOP_PX + 1));
    expect(step.state).toEqual({ phase: "dragging", didLongPress: true });
    // Order matters: the window is dismissed before the row is lifted, and all
    // three effects share the synchronous frame (the card's 同帧 requirement).
    expect(step.effects).toEqual(["close_menu", "haptic_drag", "start_drag"]);
  });

  it("movement up to the relay slop keeps the window open (no flicker)", () => {
    for (const dx of [1, MENU_TO_DRAG_RELAY_SLOP_PX]) {
      const step = stepRowGesture(menuOpen, move(dx));
      expect(step.state.phase).toBe("menu_open");
      expect(step.effects).toEqual([]);
    }
    // A 7.2px diagonal drift is still "not past" the 8px relay.
    const diagonal = stepRowGesture(menuOpen, move(4, 6));
    expect(diagonal.state.phase).toBe("menu_open");
  });

  it("the relay slop strictly exceeds the menu slop the window opened under", () => {
    expect(MENU_TO_DRAG_RELAY_SLOP_PX).toBeGreaterThan(CONTEXT_MENU_STATIONARY_SLOP_PX);
    expect(CONTEXT_MENU_STATIONARY_SLOP_PX).toBeGreaterThan(DRAG_ARM_STATIONARY_SLOP_PX);
  });

  it("after the relay, further movement never drags a second time", () => {
    const relayed = stepRowGesture(menuOpen, move(30));
    expect(relayed.state.phase).toBe("dragging");
    for (const event of [move(60), move(0, 90), move(-120, 40)]) {
      const step = stepRowGesture(relayed.state, event);
      expect(step.state).toBe(relayed.state);
      expect(step.effects).toEqual([]);
    }
  });

  it("press_out after the relay is INERT — the band ends only at drag_end (B5-F15)", () => {
    // Device finding (evidence/B5-GESTURE): the JS press_out that follows the
    // relay is RNGH's pan taking the stream over, not the finger lifting. The
    // OLD exit-to-idle here re-enabled the refresh control mid-drag; Android
    // then intercepted the live pull, cancelled the pan (drop lost, library
    // state stranded — the F14 visual) and the guard was dead (the F15 hole).
    const dragging = run([{ type: "press_in" }, armTick(), menuTick(), move(30)]);
    const step = stepRowGesture(dragging, { type: "press_out" });
    expect(step.state).toBe(dragging);
    expect(step.effects).toEqual([]);
    // The drop handler's drag_end stays the one terminator.
    const end = stepRowGesture(step.state, { type: "drag_end" });
    expect(end.state).toEqual({ phase: "idle", didLongPress: true });
  });
});

describe("drag-menu-arbitration: menu→tap selection", () => {
  it("lifting off the row keeps the window open and swallows the release-tap", () => {
    const step = stepRowGesture(run([{ type: "press_in" }, menuTick()]), {
      type: "press_out",
    });
    expect(step.state).toEqual({ phase: "idle", didLongPress: true });
    expect(step.effects).toEqual([]);
  });

  it("the next touch is a fresh tap: press_in resets the swallow flag", () => {
    const afterOut = run([{ type: "press_in" }, menuTick(), { type: "press_out" }]);
    expect(afterOut.didLongPress).toBe(true);
    const tapped = run([
      { type: "press_in" },
      menuTick(),
      { type: "press_out" },
      { type: "press_in" },
      { type: "press_out" },
    ]);
    expect(tapped).toEqual({ phase: "idle", didLongPress: false });
  });

  it("press_in re-owns the machine from every live phase", () => {
    const fromMenu = stepRowGesture(menuOpenState(), { type: "press_in" });
    expect(fromMenu.state).toEqual({ phase: "pressing", didLongPress: false });
    const fromDrag = stepRowGesture(run([{ type: "press_in" }, armTick(), move(9)]), {
      type: "press_in",
    });
    expect(fromDrag.state.phase).toBe("pressing");
  });
});

function menuOpenState(): RowGestureState {
  return run([{ type: "press_in" }, armTick(), menuTick()]);
}

// R2-01 (FIX-A): once drag() has lifted the row, RNGH owns the stream natively —
// the JS press_out that does arrive at pan takeover is inert (B5-F15), so the
// list's drop handler's band-out `drag_end` is the dragging phase's only exit;
// without it the phase stays `dragging` and the screen's scroll lock holds until
// the next press_in re-owns the machine. dragging is the ONLY phase that
// consumes drag_end — a stray drop must never kill a live press/arm/menu gesture.
describe("drag-menu-arbitration: R2-01 out-of-band drag_end", () => {
  it("drag_end releases the dragging touch to idle, keeping the press swallow", () => {
    const dragging = run([{ type: "press_in" }, armTick(), move(9)]);
    expect(dragging.phase).toBe("dragging");
    const step = stepRowGesture(dragging, { type: "drag_end" });
    expect(step.state).toEqual({ phase: "idle", didLongPress: true });
    expect(step.effects).toEqual([]);
  });

  it("drag_end is inert outside dragging (pressing/armed/menu/list_owns/idle)", () => {
    const states = [
      IDLE_ROW_GESTURE_STATE,
      run([{ type: "press_in" }]),
      run([{ type: "press_in" }, armTick()]),
      menuOpenState(),
      run([{ type: "press_in" }, move(1, 12)]), // list_owns
    ];
    for (const state of states) {
      const step = stepRowGesture(state, { type: "drag_end" });
      expect(step.state).toBe(state);
      expect(step.effects).toEqual([]);
    }
  });

  it("after the drag_end→idle cycle the next touch is a fresh press", () => {
    const state = run([
      { type: "press_in" },
      armTick(),
      move(9),
      { type: "drag_end" },
      { type: "press_in" },
    ]);
    expect(state).toEqual({ phase: "pressing", didLongPress: false });
  });
});
