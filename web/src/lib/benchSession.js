import { hydrateBenchConfig } from "./benchConfig.js";
import { createHistory } from "./history.js";

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
//
// Undo history (history.js) lives here too, so it survives a tab switch
// the same way the bench does. A step is the pair { assembly,
// importedParts }: both are immutable (every edit makes a new tree, every
// import a new Map), so a step costs two references, and undoing "Start
// over" brings the old tree back together with the meshes it used. The
// meshes are never copied or serialised.
let state = { assembly: null, importedParts: new Map(), notice: null };
const listeners = new Set();
const history = createHistory();

// An import is always registered together with the node that uses it
// (Bench.jsx's registerImport() and then pickRoot()/attachPending(), in
// one event handler). That is one thing the user did, so it is one undo
// step: setBenchImportedParts() records the pair from before both under
// a key of its own, and the setBenchAssembly() that follows in the same
// task records under that key too, so history.js coalesces it into the
// import's step (taking its label if the import had none) — two steps
// would leave an undo that removes the node but keeps an orphaned mesh.
// The fold ends at the next microtask, so it can never swallow a later,
// separate edit; the key is new for every import, so two imports in
// quick succession stay two steps.
/** @type {string | null} */
let fold = null;
let imports = 0;

function emit() {
  for (const listener of listeners) listener();
}

function endFold() {
  fold = null;
}

// Whether two assemblies are the same tree. The assembly is small plain
// JSON (ids, part ids, params, joints — meshes live in importedParts), so
// a string compare is cheap and catches an updater that rebuilt an equal
// tree, e.g. a field committing the value it already had.
function sameAssembly(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameImports(a, b) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, part] of a) if (b.get(id) !== part) return false;
  return true;
}

function currentPair() {
  return { assembly: state.assembly, importedParts: state.importedParts };
}

export function getBenchSession() {
  return state;
}

/**
 * @param {any} next the new assembly, or an updater `(assembly) => assembly`
 * @param {{ key?: string | null, label?: string | null }} [options]
 *   `key` coalesces a run of edits to one field into one undo step
 *   (history.js), `label` names the step in the Undo button's tooltip.
 */
export function setBenchAssembly(next, { key = null, label = null } = {}) {
  const assembly = typeof next === "function" ? next(state.assembly) : next;
  if (assembly === state.assembly) return;
  if (fold !== null) {
    history.record(currentPair(), { key: fold, label });
    endFold();
  } else if (!sameAssembly(assembly, state.assembly)) {
    history.record(currentPair(), { key, label });
  }
  state = { ...state, assembly, notice: null };
  emit();
}

/**
 * @param {any} next the new Map of imported parts, or an updater `(map) => map`
 * @param {{ key?: string | null, label?: string | null }} [options] as setBenchAssembly()'s
 */
export function setBenchImportedParts(next, { key = null, label = null } = {}) {
  const importedParts = typeof next === "function" ? next(state.importedParts) : next;
  if (importedParts === state.importedParts) return;
  if (!sameImports(importedParts, state.importedParts)) {
    const foldKey = key ?? `import:${++imports}`;
    history.record(currentPair(), { key: foldKey, label });
    fold = foldKey;
    queueMicrotask(() => {
      if (fold === foldKey) endFold();
    });
  }
  state = { ...state, importedParts };
  emit();
}

// Both at once (a loaded config, "Start over", the URL restore) — one
// notification, so nothing renders the new tree against the old meshes.
// A failed restore passes an empty session with a `notice`. Recorded as
// one undo step by default, so Start over and a loaded config or preset
// can be taken back; App.jsx's URL restore passes `record: false` and
// then clears the history (clearBenchHistory()), since navigating to
// another bench link is not an edit of this one. A replacement that
// changes nothing (Start over on an empty bench) records nothing.
/**
 * @param {{ assembly: any, importedParts?: Map<string, any> | null, notice?: string | null }} session
 * @param {{ record?: boolean, key?: string | null, label?: string | null }} [options]
 */
export function replaceBenchSession(
  { assembly, importedParts, notice = null },
  { record = true, key = null, label = null } = {},
) {
  const next = { assembly: assembly ?? null, importedParts: importedParts ?? new Map(), notice };
  endFold();
  if (
    record &&
    !(sameAssembly(next.assembly, state.assembly) && sameImports(next.importedParts, state.importedParts))
  ) {
    history.record(currentPair(), { key, label });
  }
  state = next;
  emit();
}

// A checked config document (a file, a saved preset) as the bench — the
// Bench's own Import config… and presets, and a user's bench-preset
// command (userCommands.js). Throws, with a message for the user, before
// anything changes when the document can't be loaded
// (benchConfig.js's hydrateBenchConfig()); one that loads is an undo step
// named `label`.
/**
 * @param {any} doc
 * @param {Map<string, any>} catalogueById
 * @param {string} label
 */
export function loadBenchConfig(doc, catalogueById, label) {
  const { assembly, importedParts } = hydrateBenchConfig(doc, catalogueById);
  replaceBenchSession({ assembly, importedParts }, { label });
}

export function subscribeBenchSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- Undo history ---------------------------------------------------------
// undoBench()/redoBench() restore both fields in one notification and
// record nothing themselves; each returns whether there was a step to
// take, so a caller can clear a selection that no longer exists.

function restore(pair) {
  if (pair === undefined) return false;
  state = { assembly: pair.assembly, importedParts: pair.importedParts, notice: null };
  emit();
  return true;
}

export function undoBench() {
  endFold();
  return restore(history.undo(currentPair()));
}

export function redoBench() {
  endFold();
  return restore(history.redo(currentPair()));
}

// For App.jsx's URL restore and hashchange: the bench was replaced from
// outside (a pasted or followed link), and its old steps would undo into
// a bench the user navigated away from.
export function clearBenchHistory() {
  endFold();
  history.clear();
}

/** @returns {import("./history.js").HistoryState} */
export function getBenchHistoryState() {
  return history.state();
}

/** @param {() => void} listener */
export function subscribeBenchHistory(listener) {
  return history.subscribe(listener);
}
