import { useSyncExternalStore } from "react";
import { listPresets, subscribePresets } from "../lib/benchPresets.js";

// The saved bench presets, live: the start screen's list and the
// sidebar's both re-render the moment one is saved or deleted.
export function useBenchPresets() {
  return useSyncExternalStore(subscribePresets, listPresets, listPresets);
}
