import { useMemo, useSyncExternalStore } from "react";
import { getGlobalOverrides, getGlobalVersion, subscribeGlobalOverrides } from "../lib/userOverrides.js";

// Settings edits invalidate both the preview and its downloadable result.
export function useGlobalOverrides() {
  const version = useSyncExternalStore(subscribeGlobalOverrides, getGlobalVersion, getGlobalVersion);
  return useMemo(() => getGlobalOverrides(), [version]);
}
