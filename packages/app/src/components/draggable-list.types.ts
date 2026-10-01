import type { ReactElement, MutableRefObject } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { GestureType } from "react-native-gesture-handler";

export interface DraggableListDragHandleProps {
  /**
   * Web-only drag handle props (from dnd-kit). Spread these onto the element
   * that should initiate the drag. Native uses the `drag()` callback instead.
   */
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  setActivatorNodeRef?: (node: unknown) => void;
}

export interface DraggableRenderItemInfo<T> {
  item: T;
  index: number;
  drag: () => void;
  isActive: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

export interface DraggableListProps<T> {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: DraggableRenderItemInfo<T>) => ReactElement;
  onDragEnd: (data: T[]) => void;
  style?: StyleProp<ViewStyle>;
  /** Outer container style (useful for nested, non-scrolling lists). */
  containerStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  ListFooterComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  showsVerticalScrollIndicator?: boolean;
  /** When false, disables internal scrolling (use outer list to scroll). */
  scrollEnabled?: boolean;
  /**
   * Web-only: when true, the drag can only be initiated from the handle props
   * passed to `renderItem` (prevents nested lists from fighting).
   */
  useDragHandle?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Fill remaining space when content is smaller than container */
  contentContainerFlexGrow?: boolean;
  /** External row state that should invalidate virtualized native cells. */
  extraData?: unknown;
  /** Gesture ref for simultaneous handling with parent gestures (e.g., sidebar close) */
  simultaneousGestureRef?: MutableRefObject<GestureType | undefined>;
  /** Whether the retained native gesture host is currently presented. */
  gestureHostPresented?: boolean;
  /** Gesture ref(s) that the list should wait for before handling scroll */
  waitFor?: MutableRefObject<GestureType | undefined> | MutableRefObject<GestureType | undefined>[];
  /** Called when a drag gesture begins (before items are reordered) */
  onDragBegin?: () => void;
  /** Called immediately before invoking row `drag()` to lock outer owners. */
  onDragIntent?: () => void;
  /** Called when drag interaction ends (finger released). */
  onDragRelease?: () => void;
  /**
   * Native-only: use the nestable draggable-flatlist variant for nested drag
   * lists coordinated by a shared NestableScrollContainer.
   */
  nestable?: boolean;
  /**
   * Native-only: external gate for the pull-to-refresh CONTROL (B5-F15).
   * `false` keeps the RefreshControl MOUNTED but hands Android's
   * SwipeRefreshLayout `setEnabled(false)` — it then neither intercepts the
   * downward pull nor shows its spinner, WITHOUT the element-shape change
   * that unmounting it causes (the F10 cell-remount trigger). The chats
   * screen drives it from its row-gesture band; consumers that pass nothing
   * keep today's behavior.
   */
  refreshControlEnabled?: boolean;
}

/**
 * The native wrapper's RefreshControl mount/enable decision, in one pure
 * function so the whole contract is testable without rendering RN.
 *
 * B5-PIN/B5-NOREFRESH (F14/F15): the OLD rule unmounted the control while a
 * drag was live (`showRefreshControl = … && (!isDragging || refreshing)`).
 * Unmounting is a CHILD-TREE SHAPE change — the F10 finding — and on-device
 * (evidence/B5-GESTURE, 2026-10-01) it remounted every cell at drag START
 * (`drag()` → onDragBegin → setIsDragging): the armed row's hook died via its
 * unmount cleanup (press_out 2-3ms after start_drag in the ReactNativeJS
 * log), which (a) dropped the screen's gesture band so a later release went
 * REFRESH-ALL (F15) and (b) churned the list mid-drag while the library's
 * RNGH pan still owned the stream — the drop could die with activeKey /
 * spacerIndexAnim / per-cell translate stranded, rows shifted by one row
 * height or stuck lifted (F14's "row vanished after a pin round-trip").
 *
 * The new rule: the control's PRESENCE depends only on `onRefresh` (and
 * `nestable`, which never renders one) — shape is constant through a drag —
 * and drag-time suppression moves to the VALUE channel: Android
 * `SwipeRefreshLayout.setEnabled(false)` (RN RefreshControl `enabled`) makes
 * the control neither intercept nor draw a spinner. `refreshing` still keeps
 * it enabled so an in-flight refresh's spinner survives a drag beginning.
 */
export function refreshControlPlan(input: {
  onRefresh: (() => void) | undefined;
  isDragging: boolean;
  refreshing: boolean | undefined;
  enabled: boolean | undefined;
  nestable: boolean | undefined;
}): { mounted: boolean; enabled: boolean } {
  return {
    mounted: Boolean(input.onRefresh) && !input.nestable,
    enabled: (input.enabled ?? true) && (!input.isDragging || Boolean(input.refreshing)),
  };
}
