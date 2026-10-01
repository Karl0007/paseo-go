// B5-PIN/B5-NOREFRESH (F14/F15) wrapper contract: the native DraggableList's
// RefreshControl decision as one pure plan (draggable-list.types.ts). The
// device finding behind it (evidence/B5-GESTURE, 2026-10-01): the old rule
// UNMOUNTED the control while a drag was live, and unmounting is the F10 child-
// tree shape change — every cell remounted at drag(), the armed row's hook died
// mid-drag (band released → later release went REFRESH-ALL), and the list
// churned under the library's still-live drag. The plan must therefore keep
// `mounted` constant across the whole gesture and move drag-time suppression
// to the `enabled` VALUE (Android SwipeRefreshLayout.setEnabled).
import { describe, expect, it } from "vitest";
import { refreshControlPlan } from "@/components/draggable-list.types";

const onRefresh = () => {};
const plan = (over: Partial<Parameters<typeof refreshControlPlan>[0]>) =>
  refreshControlPlan({
    onRefresh,
    isDragging: false,
    refreshing: false,
    enabled: undefined,
    nestable: undefined,
    ...over,
  });

describe("refreshControlPlan (B5-F14/F15 keep-mounted contract)", () => {
  it("presence follows onRefresh ONLY — dragging never changes the shape", () => {
    // The exact mid-drag sequence of the chats list: idle → armed band → drag.
    // `mounted` flipping is the F10 remount; it must hold constant while
    // onRefresh is defined, whatever isDragging/enabled do.
    const idle = plan({});
    const band = plan({ enabled: false });
    const drag = plan({ enabled: false, isDragging: true });
    const release = plan({ enabled: false, isDragging: true, refreshing: true });
    expect([idle.mounted, band.mounted, drag.mounted, release.mounted]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(plan({ onRefresh: undefined }).mounted).toBe(false);
    expect(plan({ nestable: true }).mounted).toBe(false);
  });

  it("disables the control for the band and for a live drag; re-enables outside", () => {
    // enabled=false = Android setEnabled(false): no intercept, no spinner.
    expect(plan({}).enabled).toBe(true); // plain top pull still refreshes
    expect(plan({ enabled: false }).enabled).toBe(false); // armed → menu → drag
    expect(plan({ enabled: false, isDragging: true }).enabled).toBe(false);
    // The old rule's `|| refreshing` escape lives on the VALUE channel for
    // consumers with no band gate: an in-flight refresh keeps its spinner even
    // if a drag begins. The screen's band gate (enabled=false) outranks it.
    expect(plan({ enabled: false, isDragging: true, refreshing: true }).enabled).toBe(false);
  });
});
