import { useSyncExternalStore } from "react";
import { getUpdateStatus, subscribeUpdateStatus } from "../lib/desktopUpdates.js";

/**
 * The desktop app's updater status, live (lib/desktopUpdates.js): null in
 * a browser, and until the main process first answers.
 * @returns {import("../lib/desktopBridge.js").DesktopUpdateStatus | null}
 */
export function useDesktopUpdates() {
  return useSyncExternalStore(subscribeUpdateStatus, getUpdateStatus, () => null);
}
