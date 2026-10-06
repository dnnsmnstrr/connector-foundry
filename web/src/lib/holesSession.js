// The live Holes document — the base model and the holes drilled into
// it — as module state rather than Holes.jsx's own useState, so it
// outlives the component: App.jsx renders one mode at a time, and
// switching to the Library or the Bench unmounts the Holes tab. Same
// shape as benchSession.js: one snapshot, a listener set, read through
// a useSyncExternalStore hook (hooks/useHolesSession.js).
//
// `setHolesDoc()` accepts a value or an updater, like a React setter.
// The document itself is screwHoles.js's; `null` means the start
// screen (no base chosen yet).
let state = { doc: null };
const listeners = new Set();

export function getHolesSession() {
  return state;
}

export function setHolesDoc(next) {
  const doc = typeof next === "function" ? next(state.doc) : next;
  if (doc === state.doc) return;
  state = { doc };
  for (const listener of listeners) listener();
}

export function subscribeHolesSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
