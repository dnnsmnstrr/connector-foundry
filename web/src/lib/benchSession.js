// The live bench — the assembly tree and the imported meshes it can
// reference — as module state rather than Bench.jsx's own useState, so
// it outlives the Bench component: switching to the Library unmounts the
// Bench (App.jsx renders one mode at a time) and used to take the whole
// setup with it. Now the Bench just re-reads this on remount; its render
// comes straight back out of openscad-client.js's cache.
//
// Same shape as the other stores here (uiPrefs.js's system order,
// benchPresets.js): one snapshot, a listener set, read through a
// useSyncExternalStore hook (hooks/useBenchSession.js). App.jsx also
// subscribes, to mirror the tree into the URL (benchUrlState.js).
//
// `setBenchAssembly()` / `setBenchImportedParts()` accept a value or an
// updater function, like a React setter, since Bench.jsx builds every
// edit as `(a) => addChild(a, ...)` against the current tree.
// `notice` is App.jsx's message when a bench in the URL couldn't be
// restored — shown by the Bench's start screen in place of a config
// error, and cleared by whatever replaces the session next (a loaded
// config, a picked root).
let state = { assembly: null, importedParts: new Map(), notice: null };
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

export function getBenchSession() {
  return state;
}

export function setBenchAssembly(next) {
  const assembly = typeof next === "function" ? next(state.assembly) : next;
  if (assembly === state.assembly) return;
  state = { ...state, assembly, notice: null };
  emit();
}

export function setBenchImportedParts(next) {
  const importedParts = typeof next === "function" ? next(state.importedParts) : next;
  if (importedParts === state.importedParts) return;
  state = { ...state, importedParts };
  emit();
}

// Both at once (a loaded config, "Start over", the URL restore) — one
// notification, so nothing renders the new tree against the old meshes.
// A failed restore passes an empty session with a `notice`.
export function replaceBenchSession({ assembly, importedParts, notice = null }) {
  state = { assembly: assembly ?? null, importedParts: importedParts ?? new Map(), notice };
  emit();
}

export function subscribeBenchSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
