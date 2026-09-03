import { useSyncExternalStore } from "react";
import { getSystemOrder, subscribeSystemOrder } from "../lib/uiPrefs.js";

// The user's saved system order (string[] | null — null is catalogue
// order), live: every PartBrowser re-renders when Settings changes it,
// so the Library sidebar behind the dialog reorders as headings move.
// Feed the result to catalogueUtils.js's resolveSystemOrder() to get the
// full list to actually sort by.
export function useSystemOrder() {
  return useSyncExternalStore(subscribeSystemOrder, getSystemOrder, getSystemOrder);
}
