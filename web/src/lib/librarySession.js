import { createHistory } from "./history.js";

// The Library tab's undo history, as module state rather than inside
// Library.jsx: App.jsx renders one mode at a time, so a trip to the
// Bench unmounts the Library, and a component-local history would be
// gone when the user came back — while the Bench's and the Holes tab's
// survive in their stores (benchSession.js, holesSession.js). Only the
// history lives here; the selected part and its parameters stay the
// Library's own state (App.jsx keeps them across remounts).
//
// A step is `{ partId, params }`, the selection before a change: a
// parameter edit, a handle resize, picking another part. Library.jsx
// records from its event handlers, never inside a setState updater —
// StrictMode runs updaters twice in development, which would record
// every step twice.

/** @typedef {{ partId: string | null, params: Record<string, any> }} LibraryEntry */

/** @type {import("./history.js").History<LibraryEntry>} */
const history = createHistory();

/**
 * @param {LibraryEntry} previous the selection before the change
 * @param {{ key?: string | null, label?: string | null }} [options]
 *   `key` coalesces a run of edits to one field into one undo step
 *   (e.g. `param:gx` while typing), `label` names it in the tooltip.
 */
export function recordLibrary(previous, options = {}) {
  history.record(previous, options);
}

// The entry to restore, or undefined when there is nothing to undo or
// redo; `current` is the selection now, pushed for the opposite move.
/**
 * @param {LibraryEntry} current
 * @returns {LibraryEntry | undefined}
 */
export function undoLibrary(current) {
  return history.undo(current);
}

/**
 * @param {LibraryEntry} current
 * @returns {LibraryEntry | undefined}
 */
export function redoLibrary(current) {
  return history.redo(current);
}

export function clearLibraryHistory() {
  history.clear();
}

/** @returns {import("./history.js").HistoryState} */
export function getLibraryHistoryState() {
  return history.state();
}

/** @param {() => void} listener */
export function subscribeLibraryHistory(listener) {
  return history.subscribe(listener);
}

// --- A part asked for from outside the Library --------------------------------
// The command palette and a user's command can show a part — with
// parameters of their own — in the Library. A mounted Library takes it
// here, as a pick in its list (an undo step there); when none is mounted
// this says so, and the caller hands the part over as the Library's
// initial selection instead (App.jsx's showInLibrary()).

/** @typedef {(request: { partId: string, params: Record<string, any> }) => void} LibraryRequestListener */
/** @type {Set<LibraryRequestListener>} */
const requestListeners = new Set();

/**
 * @param {string} partId
 * @param {Record<string, any>} params the whole parameter set to show
 * @returns {boolean} whether a mounted Library took it
 */
export function requestLibrarySelection(partId, params) {
  for (const listener of requestListeners) listener({ partId, params });
  return requestListeners.size > 0;
}

/** @param {LibraryRequestListener} listener */
export function subscribeLibraryRequest(listener) {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}
