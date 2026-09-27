// C30 split sizing (DESIGN-tablet.md §2 matrix / §4 row 5). The split only ever
// renders at md+ (≥720dp, §2), so these tables key md and lg (xl inherits lg).
// C31-F1 (C32): the tables are consumed through form-factor.ts — the active pair
// is picked from `useWindowDimensions()`, NOT from Unistyles breakpoint-keyed
// style values, because `rt.breakpoint` stays stale across a runtime rotation
// (device-proven) and would leave the columns on the old breakpoint.
import { MAX_CONTENT_WIDTH } from "@/constants/layout";

/** Nav rail: 56 (md) / 64 (lg+). */
export const TABLET_RAIL_WIDTH = { md: 56, lg: 64 } as const;
/** List column: 260 (md) / 300 (lg+) — narrower than the official 320 sidebar to give the detail column room (§4-5). */
export const TABLET_LIST_WIDTH = { md: 260, lg: 300 } as const;
/** Detail column floor — same value as the official desktop center minimum (components/desktop-sidebar-layout.ts:4). */
export const TABLET_DETAIL_MIN_WIDTH = 400;
/** Session content centers at the official max width (§4-5); consumed by C32. */
export const TABLET_DETAIL_CONTENT_MAX_WIDTH = MAX_CONTENT_WIDTH;
