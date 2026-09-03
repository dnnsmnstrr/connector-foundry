import { useSyncExternalStore } from "react";
import { getBenchSession, subscribeBenchSession } from "../lib/benchSession.js";

// The live bench ({ assembly, importedParts }), for the Bench itself and
// for App.jsx's URL mirroring. See lib/benchSession.js.
export function useBenchSession() {
  return useSyncExternalStore(subscribeBenchSession, getBenchSession, getBenchSession);
}
