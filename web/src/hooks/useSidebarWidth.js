import { useSyncExternalStore } from "react";
import { getSidebarWidth, subscribeSidebarWidth } from "../lib/uiPrefs.js";

// The sidebar's width in px, live (see uiPrefs.js): App puts it on the
// shell as --sidebar-width, and the resize handle reads it to report
// its position.
export function useSidebarWidth() {
  return useSyncExternalStore(subscribeSidebarWidth, getSidebarWidth, getSidebarWidth);
}
