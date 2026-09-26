// @vitest-environment jsdom
// C20 hook-level contract: the pure machine's effects must reach the real
// actuators the way the card + the MatePad Modal finding demand — the 500ms
// window DECISION arms a pending open (showing the Modal mid-gesture would
// cancel the row's touch stream), release materialises it at the anchor, and a
// slide past the 8px relay after the decision dismisses the pending window and
// fires drag() in the same synchronous pass. Drag never fires twice per touch.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";
import type { MenuContextValue } from "@/components/ui/menu";
import { useShellRowDragMenu } from "@/shell/components/use-shell-row-drag-menu";

vi.mock("expo-haptics", () => ({
  selectionAsync: vi.fn(() => Promise.resolve()),
  impactAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

const ANCHOR = { x: 100, y: 200 };

function touch(x: number, y: number): GestureResponderEvent {
  return { nativeEvent: { pageX: x, pageY: y } } as unknown as GestureResponderEvent;
}

function setup() {
  const calls: string[] = [];
  const menuController = {
    setOpen: vi.fn((open: boolean) => calls.push(`setOpen:${open}`)),
    setAnchorRect: vi.fn(),
  } as unknown as MenuContextValue;
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

describe("useShellRowDragMenu timer ladder", () => {
  it("stationary hold: 180ms arms (tick), 500ms decides the window WITHOUT showing it mid-gesture", () => {
    const { result, menuController } = setup();
    pressInAt(result);
    advance(179);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    advance(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1); // arm tick
    advance(320); // t = 500ms — the window decision
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
    // C20 device finding: no Modal may open while the finger is still down.
    expect(menuController.setOpen).not.toHaveBeenCalled();
    expect(menuController.setAnchorRect).not.toHaveBeenCalled();
  });

  it("release after the decision surfaces the window at the anchor and keeps it for the tap", () => {
    const { result, menuController, calls } = setup();
    pressInAt(result);
    advance(500);
    calls.length = 0;
    pressOut(result);
    expect(menuController.setAnchorRect).toHaveBeenCalledWith({
      x: ANCHOR.x,
      y: ANCHOR.y, // react-native-web Platform.OS !== "android" → no status-bar offset
      width: 0,
      height: 0,
    });
    expect(calls).toEqual(["setOpen:true"]);
    expect(result.current.didLongPressRef.current).toBe(true);
  });

  it("release before the decision never opens a window (quick tap)", () => {
    const { result, menuController } = setup();
    pressInAt(result);
    advance(400);
    pressOut(result);
    expect(menuController.setOpen).not.toHaveBeenCalled();
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
    expect(menuController.setOpen).not.toHaveBeenCalled();
    expect(result.current.didLongPressRef.current).toBe(true);
  });

  it("armed + clear move drags without ever deciding a window", () => {
    const { result, menuController, drag, calls } = setup();
    pressInAt(result);
    advance(180);
    moveBy(result, 10);
    expect(calls).toEqual(["drag", "onDragStart"]);
    advance(1_000);
    pressOut(result);
    expect(menuController.setOpen).not.toHaveBeenCalled(); // menu timer retired
    expect(drag).toHaveBeenCalledTimes(1);
  });
});

describe("useShellRowDragMenu C20 relay", () => {
  it("decision + >8px move: window dismissed and drag() lifted in ONE synchronous pass", () => {
    const { result, drag, calls } = setup();
    pressInAt(result);
    advance(500); // window decision (pending)
    calls.length = 0;
    moveBy(result, 11);
    // The relay step runs close_menu → haptic_drag → start_drag without any
    // await: the window is dismissed and the row lifts in the same frame —
    // the card's literal setOpen(false)+drag() seam.
    expect(calls).toEqual(["setOpen:false", "drag", "onDragStart"]);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
    expect(result.current.didLongPressRef.current).toBe(true);
    expect(drag).toHaveBeenCalledTimes(1);
    // And the release that follows must NOT resurrect the dismissed window.
    calls.length = 0;
    pressOut(result);
    expect(calls).toEqual([]);
  });

  it("a window shown by an earlier gesture is really dismissed by a later relay", () => {
    const { result, menuController, calls } = setup();
    pressInAt(result);
    advance(500);
    pressOut(result); // window shown
    expect(menuController.setOpen).toHaveBeenLastCalledWith(true);
    pressInAt(result); // a new touch reaching the row again
    advance(500);
    calls.length = 0;
    moveBy(result, 12); // relay
    expect(calls).toEqual(["setOpen:false", "drag", "onDragStart"]);
  });

  it("movement up to the 8px relay keeps the decision; later relay drags exactly once", () => {
    const { result, drag, calls } = setup();
    pressInAt(result);
    advance(500);
    calls.length = 0;
    moveBy(result, 4, 6); // 7.2px — not past the relay slop
    expect(calls).toEqual([]);
    moveBy(result, 10, 1);
    expect(calls.filter((c) => c === "drag")).toHaveLength(1);
    moveBy(result, 40);
    moveBy(result, -80, 20);
    expect(drag).toHaveBeenCalledTimes(1); // never a second drag() this touch
  });

  it("press_out after the relay resets the stream; a fresh tap is not swallowed", () => {
    const { result } = setup();
    pressInAt(result);
    advance(500);
    moveBy(result, 11);
    pressOut(result);
    expect(result.current.didLongPressRef.current).toBe(true);
    pressInAt(result);
    expect(result.current.didLongPressRef.current).toBe(false);
    pressOut(result);
    expect(result.current.didLongPressRef.current).toBe(false);
  });

  it("unmount mid-hold retires both timers and the pending window", () => {
    const drag = vi.fn();
    const menuController = {
      setOpen: vi.fn(),
      setAnchorRect: vi.fn(),
    } as unknown as MenuContextValue;
    const { result, unmount } = renderHook(() => useShellRowDragMenu({ drag, menuController }));
    act(() => result.current.handlePressIn(touch(ANCHOR.x, ANCHOR.y)));
    advance(500); // decision armed
    unmount();
    advance(1_000);
    expect(menuController.setOpen).not.toHaveBeenCalled();
    expect(drag).not.toHaveBeenCalled();
  });
});

describe("useShellRowDragMenu scroll-lock guard (C20 device finding #2)", () => {
  function lockSetup() {
    const onGestureLockChange = vi.fn();
    const menuController = {
      setOpen: vi.fn(),
      setAnchorRect: vi.fn(),
    } as unknown as MenuContextValue;
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

  it("keeps the lock across the menu decision and the relay into dragging", () => {
    const { result, onGestureLockChange } = lockSetup();
    pressInAt(result);
    advance(500); // armed + menu decision, still locked, no second call
    expect(onGestureLockChange).toHaveBeenCalledTimes(1);
    expect(onGestureLockChange).toHaveBeenCalledWith(true);
    moveBy(result, 11); // relay → dragging, still locked
    expect(onGestureLockChange).toHaveBeenCalledTimes(1);
    pressOut(result);
    expect(onGestureLockChange).toHaveBeenLastCalledWith(false);
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
