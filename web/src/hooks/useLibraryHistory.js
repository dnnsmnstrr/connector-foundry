import { useSyncExternalStore } from "react";
import { getLibraryHistoryState, subscribeLibraryHistory } from "../lib/librarySession.js";

// { canUndo, canRedo, undoLabel, redoLabel } for the Library's undo history
// (lib/librarySession.js), which outlives the Library component.
export function useLibraryHistory() {
  return useSyncExternalStore(subscribeLibraryHistory, getLibraryHistoryState, getLibraryHistoryState);
}
