import { useSyncExternalStore } from "react";
import { getWebAppStatus, subscribeWebAppStatus } from "../lib/webApp.js";

/**
 * The installed web app's status, live (lib/webApp.js): whether it runs
 * from the home screen, how it can be installed, and whether a newer build
 * is ready.
 * @returns {import("../lib/webApp.js").WebAppStatus}
 */
export function useWebApp() {
  return useSyncExternalStore(subscribeWebAppStatus, getWebAppStatus, getWebAppStatus);
}
