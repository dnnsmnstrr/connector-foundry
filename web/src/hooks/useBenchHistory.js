import { useSyncExternalStore } from "react";
import { getBenchHistoryState, subscribeBenchHistory } from "../lib/benchSession.js";

// { canUndo, canRedo, undoLabel, redoLabel } for the bench's undo history
// (lib/benchSession.js), for the Undo/Redo buttons. undoBench() and
// redoBench() are called directly.
export function useBenchHistory() {
  return useSyncExternalStore(subscribeBenchHistory, getBenchHistoryState, getBenchHistoryState);
}
