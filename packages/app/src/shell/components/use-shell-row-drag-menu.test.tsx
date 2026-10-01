// @vitest-environment jsdom
// KI-11 hook-level contract: the pure machine's effects reach the real
// actuators the rulings demand — the 250ms stationary hold (KI-16 halving) OPENS the shell-hosted
// window menu immediately (finger still down; the surface lives in the app window,
// so the touch stream survives — the C20 Modal finding that forced the old
// pending-release actuator is retired), a slide past the 8px relay dismisses the
// VISIBLE menu and fires drag() in the same synchronous pass, and release neither
// opens nor closes anything. Drag never fires twice per touch.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";
import {
  createDragLockHandoff,
  useShellRowDragMenu,
  type RowMenuController,
} from "@/shell/components/use-shell-row-drag-menu";

vi.mock("expo-haptics", () => ({
  selectionAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

const ANCHOR = { x: 100, y: 200 };

function touch(x: number, y: number): GestureResponderEvent {
  return { nativeEvent: { pageX: x, pageY: y } } as unknown as GestureResponderEvent;
}

function setup() {
  const calls: string[] = [];
  const menuController: RowMenuController = {
    openMenu: vi.fn((anchor: { x: number; y: number }) =>
      calls.push(`openMenu:${anchor.x},${anchor.y}`),
    ),
    closeMenu: vi.fn(() => calls.push("closeMenu")),
  };
  const drag = vi.fn(() => calls.push("drag"));
  const onDragStart = vi.fn(() => calls.push("onDragStart"));
  const { result } = renderHook(() => useShellRowDragMenu({ drag, menuController, onDragStart }));
  return { calls, menuController, drag, onDragStart, result };
}

type Result = ReturnType<typeof setup>["result"];

function pressInAt(result: Result, x = ANCHOR.x, y = ANCHOR.y) {
  act(() => result.current.handlePressIn(touch(x, y)));
}

function moveBy(result: Result, dx: number, dy = 0) {
  act(() => result.current.handleTouchMove(touch(ANCHOR.x + dx, ANCHOR.y + dy)));
}

function pressOut(result: Result) {
  act(() => result.current.handlePressOut());
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

describe("useShellRowDragMenu timer ladder (KI-11 ruling ①)", () => {
  it("stationary hold: 180ms arms (tick), 249ms does NOT open, 250ms OPENS at the anchor", () => {
    const { result, menuController, calls } = setup();
    pressInAt(result);
    advance(179);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    advance(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1); // arm tick
    expect(menuController.openMenu).not.toHaveBeenCalled(); // pressing/armed opens nothing
    advance(69); // t = 249ms — KI-16 boundary: one ms short, nothing opens
    expect(menuController.openMenu).not.toHaveBeenCalled();
    advance(1); // t = 250ms — the window decision (halved from 500)
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
    // Ruling ①: the window is VISIBLE now, finger still down — responder-space
    // anchor, no status-bar shift (the surface shares the list's window).
    expect(calls).toEqual([`openMenu:${ANCHOR.x},${ANCHOR.y}`]);
    expect(menuController.closeMenu).not.toHaveBeenCalled();
  });

  it("release after the decision neither re-opens nor closes; the tap is swallowed", () => {
    const { result, menuController, calls } = setup();
    pressInAt(result);
    advance(250);
    calls.length = 0;
    pressOut(result);
    expect(calls).toEqual([]); // nothing materialises on release anymore
    expect(menuController.openMenu).toHaveBeenCalledTimes(1); // still the 250ms open
    expect(result.current.didLongPressRef.current).toBe(true);
  });

  it("release at 249ms — one ms before the decision — never opens a window (KI-16 boundary)", () => {
    const { result, menuController } = setup();
    pressInAt(result);
    advance(249);
    pressOut(result);
    expect(menuController.openMenu).not.toHaveBeenCalled();
    expect(result.current.didLongPressRef.current).toBe(false);
  });

  it("vertical scroll before arm kills both timers: no arm, no window, no drag", () => {
    const { result, menuController, drag } = setup();
    pressInAt(result);
    advance(100);
    moveBy(result, 1, 12);
    advance(1_000);
    pressOut(result);
    expect(drag).not.toHaveBeenCalled();
    expect(menuController.openMenu).not.toHaveBeenCalled();
    expect(result.current.didLongPressRef.current).toBe(true);
  });

  it("armed + clear move drags without ever opening a window", () => {
    const { result, menuController, drag, calls } = setup();
    pressInAt(result);
    advance(180);
    moveBy(result, 10);
    expect(calls).toEqual(["drag", "onDragStart"]);
    advance(1_000);
    pressOut(result);
    expect(menuController.openMenu).not.toHaveBeenCalled(); // menu timer retired
    expect(drag).toHaveBeenCalledTimes(1);
  });
});

describe("useShellRowDragMenu KI-11 relay (ruling ②)", () => {
  it("visible menu + >8px move: menu closed and drag() lifted in ONE synchronous pass", () => {
    const { result, drag, calls } = setup();
    pressInAt(result);
    advance(250); // the menu opened mid-hold
    expect(calls).toEqual([`openMenu:${ANCHOR.x},${ANCHOR.y}`]);
    calls.length = 0;
    moveBy(result, 11);
    // The relay step runs close_menu → haptic_drag → start_drag without any
    // await: the visible menu is dismissed and the row lifts in the same frame
    // — no gap where "the menu closed but the drag never connected".
    expect(calls).toEqual(["closeMenu", "drag", "onDragStart"]);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
    expect(result.current.didLongPressRef.current).toBe(true);
    expect(drag).toHaveBeenCalledTimes(1);
    // And the release that follows must NOT resurrect anything.
    calls.length = 0;
    pressOut(result);
    expect(calls).toEqual([]);
  });

  it("a menu left open by an earlier touch is replaced by the next hold and then relayed", () => {
    const { result, menuController, calls } = setup();
    pressInAt(result);
    advance(250);
    pressOut(result); // finger lifts; the menu stays open (backdrop owns it now)
    expect(menuController.closeMenu).not.toHaveBeenCalled();
    pressInAt(result); // a new touch reaching the row again
    advance(250); // re-opens at the (same) anchor — the store replaces the request
    expect(menuController.openMenu).toHaveBeenCalledTimes(2);
    calls.length = 0;
    moveBy(result, 12); // relay
    expect(calls).toEqual(["closeMenu", "drag", "onDragStart"]);
  });

  it("movement up to the 8px relay keeps the menu open; later relay drags exactly once", () => {
    const { result, drag, calls } = setup();
    pressInAt(result);
    advance(250);
    calls.length = 0;
    moveBy(result, 4, 6); // 7.2px — not past the relay slop
    expect(calls).toEqual([]); // the visible menu survives the drift
    moveBy(result, 10, 1);
    expect(calls.filter((c) => c === "drag")).toHaveLength(1);
    expect(calls).toContain("closeMenu");
    moveBy(result, 40);
    moveBy(result, -80, 20);
    expect(drag).toHaveBeenCalledTimes(1); // never a second drag() this touch
  });

  it("press_out after the relay is inert; a fresh tap is not swallowed", () => {
    const { result } = setup();
    pressInAt(result);
    advance(250);
    moveBy(result, 11);
    pressOut(result);
    expect(result.current.didLongPressRef.current).toBe(true);
    pressInAt(result);
    expect(result.current.didLongPressRef.current).toBe(false);
    pressOut(result);
    expect(result.current.didLongPressRef.current).toBe(false);
  });

  it("unmount mid-hold retires both timers and closes this row's menu", () => {
    const drag = vi.fn();
    const menuController: RowMenuController = {
      openMenu: vi.fn(),
      closeMenu: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useShellRowDragMenu({ drag, menuController }));
    act(() => result.current.handlePressIn(touch(ANCHOR.x, ANCHOR.y)));
    advance(250); // the menu is visible
    expect(menuController.openMenu).toHaveBeenCalledTimes(1);
    unmount();
    // A row that vanishes (data churn) must not leave its menu hosted.
    expect(menuController.closeMenu).toHaveBeenCalledTimes(1);
    expect(drag).not.toHaveBeenCalled();
  });
});

describe("useShellRowDragMenu scroll-lock guard (C20 device finding #2)", () => {
  function lockSetup() {
    const onGestureLockChange = vi.fn();
    const menuController: RowMenuController = {
      openMenu: vi.fn(),
      closeMenu: vi.fn(),
    };
    const { result, unmount } = renderHook(() =>
      useShellRowDragMenu({
        drag: vi.fn(),
        menuController,
        onGestureLockChange,
      }),
    );
    return { result, unmount, onGestureLockChange };
  }

  it("locks when the touch arms (180ms stationary) and releases on press_out", () => {
    const { result, onGestureLockChange } = lockSetup();
    pressInAt(result);
    expect(onGestureLockChange).not.toHaveBeenCalled(); // pressing is not a lock
    advance(180); // armed → lock
    expect(onGestureLockChange).toHaveBeenCalledWith(true);
    pressOut(result); // idle → release
    expect(onGestureLockChange).toHaveBeenLastCalledWith(false);
    expect(onGestureLockChange).toHaveBeenCalledTimes(2);
  });

  it("keeps the lock across the menu open, the relay, AND the takeover press_out (B5-F15)", () => {
    // The press_out that arrives when RNGH's pan activates mid-drag must NOT
    // release the band — releasing it there re-enabled the refresh control
    // while the finger was still pulling (the F15 hole; evidence/B5-GESTURE).
    const { result, onGestureLockChange } = lockSetup();
    pressInAt(result);
    advance(250); // armed + menu visible, still locked, no second call
    expect(onGestureLockChange).toHaveBeenCalledTimes(1);
    expect(onGestureLockChange).toHaveBeenCalledWith(true);
    moveBy(result, 11); // relay → dragging, still locked
    expect(onGestureLockChange).toHaveBeenCalledTimes(1);
    pressOut(result); // RNGH takeover: inert — the band lives until drag_end
    expect(onGestureLockChange).toHaveBeenCalledTimes(1);
  });

  it("a pre-arm scroll takeover never locks", () => {
    const { result, onGestureLockChange } = lockSetup();
    pressInAt(result);
    advance(100);
    moveBy(result, 1, 12); // vertical dominance before arm → list_owns
    expect(onGestureLockChange).not.toHaveBeenCalled();
    pressOut(result);
    expect(onGestureLockChange).not.toHaveBeenCalled();
  });

  it("unmount mid-gesture releases a live lock (cell churn guard)", () => {
    const { result, unmount, onGestureLockChange } = lockSetup();
    pressInAt(result);
    advance(180); // armed → locked
    expect(onGestureLockChange).toHaveBeenCalledWith(true);
    unmount();
    expect(onGestureLockChange).toHaveBeenLastCalledWith(false);
  });
});

// R2-01 (FIX-A): after drag() the native RNGH stream owns the touch — the JS
// press_out it brings is inert (B5-F15), so the lock must be releasable out-of-
// band by the list's drop handler. The hook hands the screen a release in the
// SAME frame as drag() (the onDragStart seam), the release runs the machine's
// drag_end edge (single source of truth — the screen never setState's the lock
// itself), and the screen-side handoff consumes it exactly once per drop.
describe("useShellRowDragMenu R2-01 out-of-band drag release", () => {
  function releaseSetup() {
    const onGestureLockChange = vi.fn();
    const menuController: RowMenuController = {
      openMenu: vi.fn(),
      closeMenu: vi.fn(),
    };
    let release: (() => void) | null = null;
    const { result } = renderHook(() =>
      useShellRowDragMenu({
        drag: vi.fn(),
        menuController,
        onDragStart: (fn) => {
          release = fn;
        },
        onGestureLockChange,
      }),
    );
    return { result, onGestureLockChange, getRelease: () => release };
  }

  it("drag() hands the screen a release that unlocks from dragging WITHOUT press_out", () => {
    const { result, onGestureLockChange, getRelease } = releaseSetup();
    pressInAt(result);
    advance(180); // armed → lock
    moveBy(result, 10); // relay/armed move → dragging; the JS stream ends here
    expect(onGestureLockChange).toHaveBeenLastCalledWith(true);
    const release = getRelease();
    expect(release).toBeTypeOf("function");
    act(() => release!()); // the list's onDragEnd
    expect(onGestureLockChange).toHaveBeenLastCalledWith(false);
    expect(onGestureLockChange).toHaveBeenCalledTimes(2);
    // Idempotent: a library that ever calls onDragEnd twice must not double-fire.
    act(() => release!());
    expect(onGestureLockChange).toHaveBeenCalledTimes(2);
  });

  it("after the release the hook keeps one truth: a later press_out is inert and the next touch re-locks", () => {
    const { result, onGestureLockChange, getRelease } = releaseSetup();
    pressInAt(result);
    advance(180);
    moveBy(result, 10); // dragging, locked
    act(() => getRelease()!());
    expect(onGestureLockChange).toHaveBeenCalledTimes(2); // true, false
    pressOut(result); // a late/forced press_out must not re-toggle
    expect(onGestureLockChange).toHaveBeenCalledTimes(2);
    // The stale-lock mirror bug: a fresh touch must reach `armed` and lock again.
    pressInAt(result);
    advance(180);
    expect(onGestureLockChange).toHaveBeenCalledTimes(3);
    expect(onGestureLockChange).toHaveBeenLastCalledWith(true);
  });

  it("a release from a non-dragging touch is inert (no stray drop kills a live lock)", () => {
    const { result, onGestureLockChange, getRelease } = releaseSetup();
    pressInAt(result);
    advance(180); // armed → locked, but no drag() → no release handed out
    expect(getRelease()).toBeNull();
    expect(onGestureLockChange).toHaveBeenCalledTimes(1);
  });
});

// The screen-side seam of the same fix: handleRowDragStart records the row's
// release, handleDragEnd runs it FIRST (before the search-mode early return)
// and forgets it. The handoff owns that record/consume-once/exactly-once pair.
describe("createDragLockHandoff (screen-side drop seam)", () => {
  it("releases the recorded lock exactly once and forgets it", () => {
    const handoff = createDragLockHandoff();
    handoff.release(); // drop without a recorded drag (drag-inert belt): inert
    const release = vi.fn();
    handoff.record(release);
    handoff.release();
    expect(release).toHaveBeenCalledTimes(1);
    handoff.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a newer drag replaces the release before the old one ever runs", () => {
    const handoff = createDragLockHandoff();
    const first = vi.fn();
    const second = vi.fn();
    handoff.record(first);
    handoff.record(second);
    handoff.release();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
