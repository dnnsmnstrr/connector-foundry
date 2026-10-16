import { createHistory } from "./history.js";

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
//
// Every change is an undo step (history.js), including a new document
// ("Start", App.jsx's Open in Holes) and going back to the start screen
// ("Pick another model"): undo brings the previous model and its holes
// back. Nothing in the app clears the history short of a reload.
// Documents are immutable, so a step is one reference; a mesh source's
// bytes are shared with it, never copied.
let state = { doc: null };
const listeners = new Set();
const history = createHistory();

// The small JSON fields of a document. Anything else on it (the source
// aside) is compared by identity, so a field added later that holds a
// mesh can never be stringified here.
const JSON_FIELDS = new Set(["holes", "name", "nextSpec", "nextPresetId"]);

function sameJson(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// A base-parameter edit makes a new `source` object on every keystroke
// ({ ...source, params }), so the source is compared field by field: its
// params as JSON, everything else (kind, partId, a mesh's name, geometry,
// bytes, flip) by identity.
function sameSource(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => (k === "params" ? sameJson(a[k], b[k]) : a[k] === b[k]));
}

function sameDoc(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    if (!(k in b)) return false;
    if (k === "source") return sameSource(a.source, b.source);
    return JSON_FIELDS.has(k) ? sameJson(a[k], b[k]) : a[k] === b[k];
  });
}

function emit() {
  for (const listener of listeners) listener();
}

export function getHolesSession() {
  return state;
}

/**
 * @param {any} next the new document (or null), or an updater `(doc) => doc`
 * @param {{ key?: string | null, label?: string | null }} [options]
 *   `key` coalesces a run of edits to one field into one undo step
 *   (history.js), `label` names the step in the Undo button's tooltip.
 */
export function setHolesDoc(next, { key = null, label = null } = {}) {
  const doc = typeof next === "function" ? next(state.doc) : next;
  if (doc === state.doc) return;
  if (!sameDoc(doc, state.doc)) history.record(state.doc, { key, label });
  state = { doc };
  emit();
}

export function subscribeHolesSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- Undo history ---------------------------------------------------------
// Each returns whether there was a step to take; the Holes tab then drops
// selected ids the restored document no longer has.

function restore(doc) {
  if (doc === undefined) return false;
  state = { doc };
  emit();
  return true;
}

export function undoHoles() {
  return restore(history.undo(state.doc));
}

export function redoHoles() {
  return restore(history.redo(state.doc));
}

// Unused by the app (see the header); the unit tests start from a clean
// history with it.
export function clearHolesHistory() {
  history.clear();
}

/** @returns {import("./history.js").HistoryState} */
export function getHolesHistoryState() {
  return history.state();
}

/** @param {() => void} listener */
export function subscribeHolesHistory(listener) {
  return history.subscribe(listener);
}
