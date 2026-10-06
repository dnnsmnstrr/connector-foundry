import { useSyncExternalStore } from "react";
import { getHolesSession, subscribeHolesSession } from "../lib/holesSession.js";

// The live Holes document ({ doc }), for the Holes tab. See lib/holesSession.js.
export function useHolesSession() {
  return useSyncExternalStore(subscribeHolesSession, getHolesSession, getHolesSession);
}
