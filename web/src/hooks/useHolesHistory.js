import { useSyncExternalStore } from "react";
import { getHolesHistoryState, subscribeHolesHistory } from "../lib/holesSession.js";

// { canUndo, canRedo, undoLabel, redoLabel } for the Holes document's undo
// history (lib/holesSession.js). undoHoles() and redoHoles() are called
// directly.
export function useHolesHistory() {
  return useSyncExternalStore(subscribeHolesHistory, getHolesHistoryState, getHolesHistoryState);
}
