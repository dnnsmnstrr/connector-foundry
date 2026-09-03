import { useSyncExternalStore } from "react";
import { getHiddenLibrary, subscribeHiddenLibrary } from "../lib/uiPrefs.js";

// What the user has hidden from the part lists ({ systems, parts } — see
// uiPrefs.js), live: every PartBrowser re-renders as Settings changes it,
// so the Library sidebar behind the dialog thins out as boxes are
// unticked. Feed it to catalogueUtils.js's listedParts().
export function useHiddenLibrary() {
  return useSyncExternalStore(subscribeHiddenLibrary, getHiddenLibrary, getHiddenLibrary);
}
