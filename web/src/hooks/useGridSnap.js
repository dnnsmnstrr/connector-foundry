import { useSyncExternalStore } from "react";
import { getGridSnap, subscribeGridSnap } from "../lib/uiPrefs.js";

// The grid in mm (0 = Off), live: the viewer's Grid select, the Holes
// Snapping section and Settings all show the one value (see uiPrefs.js).
// A drag reads getGridSnap() directly when it needs the number, so a
// change mid-gesture doesn't re-render anything.
export function useGridSnap() {
  return useSyncExternalStore(subscribeGridSnap, getGridSnap, getGridSnap);
}
