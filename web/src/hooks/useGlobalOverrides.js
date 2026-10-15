import { useMemo, useSyncExternalStore } from "react";
import { getGlobalOverrides, getGlobalVersion, subscribeGlobalOverrides } from "../lib/userOverrides.js";

// Settings edits invalidate both the preview and its downloadable result.
export function useGlobalOverrides() {
  const version = useSyncExternalStore(subscribeGlobalOverrides, getGlobalVersion, getGlobalVersion);
  // `version` is the store's change counter: it is in the list so the memo
  // re-reads the store when it ticks, not because the value is read here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getGlobalOverrides(), [version]);
}
