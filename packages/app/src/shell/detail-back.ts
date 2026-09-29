// KI-9: the ONE back verb for the (detail) root-stack screens (files/import/
// commands-edit/rename). Each screen is a real root-Stack push, so back is a real
// pop onto whatever screen opened it — hardware/gesture back already does exactly
// this, and the header back button mirrors it. The only screen-specific piece is
// the deep-link fallback: when the screen is the FIRST root-stack entry there is
// nothing to pop, and the screen lands on its own tab (the hidden-tab era's
// in-tab jump, kept as the兑底 only). preview.tsx / (detail)/files carried this
// two-line idiom inline; every migrated screen goes through here so the posture
// cannot drift.
import { router, type Href } from "expo-router";

/** Pop the stack; with nothing underneath, replace onto `fallback`. */
export function detailBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
