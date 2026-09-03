import { useSyncExternalStore } from "react";
import { getRenderActivity, subscribeRenderActivity } from "../lib/openscad-client.js";

// Number of OpenSCAD renders currently in flight, app-wide — 0 means idle.
// Backed by openscad-client's inFlight map, so it covers every render
// from every screen without any of them reporting status up the tree.
export function useRenderActivity() {
  return useSyncExternalStore(subscribeRenderActivity, getRenderActivity, () => 0);
}
