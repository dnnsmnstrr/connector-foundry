import { useSyncExternalStore } from "react";
import { getDrawerTab, isDrawerLayout, subscribeDrawerLayout, subscribeDrawerTab } from "../lib/drawer.js";

// Whether the sidebar is a bottom drawer right now (the narrow layout,
// lib/drawer.js), live: a phone turned to landscape, or a browser window
// dragged wider than 900 px, goes back to the column.
export function useDrawerLayout() {
  return useSyncExternalStore(subscribeDrawerLayout, isDrawerLayout, () => false);
}

// The Library drawer's tab on show ("params" or "parts").
export function useDrawerTab() {
  return useSyncExternalStore(subscribeDrawerTab, getDrawerTab, getDrawerTab);
}
