import { useSyncExternalStore } from "react";
import { getSidebarWidth, subscribeSidebarWidth } from "../lib/uiPrefs.js";

// The sidebar's width in px, live (see uiPrefs.js), for the resize handle
// (components/SidebarResizer.jsx) to report its position. App.jsx does
// not use it: its ShellBody writes --sidebar-width onto the shell through
// a ref, straight from the store, so a drag doesn't re-render the mode.
export function useSidebarWidth() {
  return useSyncExternalStore(subscribeSidebarWidth, getSidebarWidth, getSidebarWidth);
}
