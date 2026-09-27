// §4-8 alignment point: re-tapping the live rail item means "scroll this list
// to top" (WeChat behaviour). C30 shipped the emitter as a stub; C31 wired both
// halves — nav-rail emits, and the three screen bodies (chats/workspace/me)
// subscribe here. A module-level listener set keeps the host free of refs into
// screens it does not own (same posture as the route-derived selection, §3.2).
import type { TabletSection } from "./split-predicates";

export type RailRetapListener = (section: TabletSection) => void;

const retapListeners = new Set<RailRetapListener>();

export function subscribeRailRetap(listener: RailRetapListener): () => void {
  retapListeners.add(listener);
  return () => retapListeners.delete(listener);
}

export function emitRailRetap(section: TabletSection): void {
  for (const listener of retapListeners) listener(section);
}
