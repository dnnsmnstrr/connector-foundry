// The workspace — the tab, the Library's selection, the Bench and the
// Holes document — kept in localStorage so closing the app (or reloading
// it, or the desktop shell opening a hash-less URL on the next launch)
// comes back to what was on screen. The URL still carries the Bench for a
// shared link and takes precedence when it names one; this is the
// fallback for when there is no link to follow.
//
// Everything here is untrusted on the way back in: localStorage is a file
// the user (or any page on this origin) can edit. Each reader validates
// the shape and values and lets a broken entry fall back to a fresh
// start rather than throwing into the boot path. The Bench and Holes
// documents go through the same checks their file imports do
// (benchConfig.js / screwHoles.js), and a mesh is re-validated by
// meshValidate.js before it becomes a part again.
//
// Writes are debounced: dragging a hole or typing a parameter changes the
// document many times a second, and serialising a mesh is the expensive
// part. `flushWorkspace()` writes whatever is pending now — App calls it
// when the page is hidden, and the updater calls it before a reload or
// restart.
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { base64ToBytes, bytesToBase64, isParamSet } from "./benchConfig.js";
import { STORED_IMPORTS_KEY, benchTree, restoreBenchFromTree, saveStoredImports } from "./benchUrlState.js";
import { meshSource } from "./holesRender.js";
import { geometryStlBytes } from "./importedPart.js";
import { validateAndRepair } from "./meshValidate.js";
import { normalizeSpec } from "./screwHoles.js";
import { resolveParams } from "./userOverrides.js";

// Also read by settingsBackup.js, which leaves the workspace out of a
// settings backup: it is what this browser was doing, not a preference.
export const WORKSPACE_PREFIX = "connector-foundry:workspace:";
const VIEW_KEY = `${WORKSPACE_PREFIX}view`;
const BENCH_KEY = `${WORKSPACE_PREFIX}bench`;
const HOLES_KEY = `${WORKSPACE_PREFIX}holes`;

const WORKSPACE_FORMAT = "connector-foundry/workspace";
const WORKSPACE_VERSION = 1;

// Long enough that a run of keystrokes or a handle drag writes once, short
// enough that a window closed without pagehide (a crash, a phone killing a
// backgrounded app) has usually written the last edit.
export const WORKSPACE_WRITE_DELAY_MS = 400;

const MODES = new Set(["library", "bench", "holes"]);

/** @param {string} key */
export function isWorkspaceKey(key) {
  return typeof key === "string" && key.startsWith(WORKSPACE_PREFIX);
}

function storageOrNull() {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
  } catch {
    // A private window or a sandboxed frame refuses even to hand it over.
    return null;
  }
}

function envelope(data) {
  return { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, ...data };
}

function readDoc(key) {
  const storage = storageOrNull();
  if (!storage) return null;
  let doc;
  try {
    doc = JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
  if (!isObject(doc) || doc.format !== WORKSPACE_FORMAT || doc.version !== WORKSPACE_VERSION) return null;
  return doc;
}

// A failed write (quota, blocked storage) drops the old entry rather than
// leaving a stale workspace that would come back as if it were current.
function writeDoc(key, doc) {
  const storage = storageOrNull();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(doc));
    return true;
  } catch (err) {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing more to do; the session still has the live state.
    }
    console.warn("Workspace: couldn't save it for next time:", err);
    return false;
  }
}

function removeDoc(key) {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort, as above.
  }
}

// --- scheduling ---------------------------------------------------------

/** @type {Map<string, () => boolean | void>} */
const pending = new Map();
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

function schedule(name, job) {
  pending.set(name, job);
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    flushWorkspace();
  }, WORKSPACE_WRITE_DELAY_MS);
}

// Writes every pending entry now (the debounce is skipped) and returns
// whether all of them could be saved. A caller that is about to reload
// uses the return value only for logging; the writes themselves are
// already best-effort.
export function flushWorkspace() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  let ok = true;
  for (const [name, job] of [...pending]) {
    pending.delete(name);
    try {
      if (job() === false) ok = false;
    } catch (err) {
      ok = false;
      console.warn(`Workspace: couldn't save "${name}":`, err);
    }
  }
  return ok;
}

// --- the tab and the Library's selection --------------------------------

/**
 * @param {{ mode: string, library: { part: any, params: Record<string, any> } | null }} view
 */
export function scheduleWorkspaceView({ mode, library }) {
  schedule("view", () => {
    const storedLibrary =
      library && isParamSet(library.params) ? { partId: library.part.id, params: library.params } : null;
    return writeDoc(
      VIEW_KEY,
      envelope({
        mode: MODES.has(mode) ? mode : "library",
        library: storedLibrary,
      }),
    );
  });
}

/**
 * The stored tab and Library selection, checked against the live
 * catalogue. `mode` is null when the stored value isn't one of ours, and
 * `library` is null when that part no longer exists (or its parameters
 * aren't usable); the caller falls back to its own defaults.
 * @param {Map<string, any>} catalogueById
 * @returns {{ mode: string | null, library: { part: any, params: Record<string, any> } | null } | null}
 */
export function restoreWorkspaceView(catalogueById) {
  const doc = readDoc(VIEW_KEY);
  if (!doc) return null;
  const mode = MODES.has(doc.mode) ? doc.mode : null;
  let library = null;
  const saved = doc.library;
  if (isObject(saved) && typeof saved.partId === "string" && isParamSet(saved.params)) {
    const part = catalogueById.get(saved.partId);
    if (part) library = { part, params: resolveParams(part, saved.params) };
  }
  if (!mode && !library) return null;
  return { mode, library };
}

// --- the Bench ----------------------------------------------------------

/** @param {any} assembly */
export function scheduleWorkspaceBench(assembly) {
  schedule("bench", () => {
    if (!assembly) {
      removeDoc(BENCH_KEY);
      return true;
    }
    return writeDoc(BENCH_KEY, envelope({ tree: benchTree(assembly) }));
  });
}

/**
 * The stored Bench as { assembly, importedParts }, or null when there is
 * none. Throws with a user-facing message when it names something the
 * catalogue or this browser's imports no longer have, exactly as a link
 * would.
 * @param {Map<string, any>} catalogueById
 */
export function restoreWorkspaceBench(catalogueById) {
  const doc = readDoc(BENCH_KEY);
  if (!doc || !isObject(doc.tree)) return null;
  return restoreBenchFromTree(doc.tree, catalogueById);
}

// The imported meshes are shared with the URL's bench and are written
// eagerly: a tree that names one must never be stored before its bytes.
/** @param {any} assembly @param {Map<string, any>} partsById */
export function saveWorkspaceImports(assembly, partsById) {
  saveStoredImports(assembly, partsById);
}

// The store the Bench reads from, for tests that want to clean up.
export { STORED_IMPORTS_KEY };

// --- the Holes document -------------------------------------------------

// A mesh's base64 never changes once imported, and the same geometry is
// carried by every undo step the document makes (a Flip makes a new
// source with the same geometry). Encoding it once per geometry is the
// difference between a few milliseconds and tens of them on every drag.
/** @type {WeakMap<object, string>} */
const meshBase64ByGeometry = new WeakMap();

function meshBase64(source) {
  let encoded = meshBase64ByGeometry.get(source.geometry);
  if (encoded === undefined) {
    encoded = bytesToBase64(geometryStlBytes(source.geometry));
    meshBase64ByGeometry.set(source.geometry, encoded);
  }
  return encoded;
}

function serializeHolesDoc(doc) {
  const source =
    doc.source.kind === "catalogue"
      ? { kind: "catalogue", partId: doc.source.partId, params: { ...doc.source.params } }
      : {
          kind: "mesh",
          name: doc.source.name,
          flip: Boolean(doc.source.flip),
          stl: meshBase64(doc.source),
        };
  return envelope({
    source,
    holes: doc.holes,
    name: doc.name ?? null,
    nextSpec: doc.nextSpec,
    nextPresetId: doc.nextPresetId ?? null,
  });
}

/** @param {any} doc */
export function scheduleWorkspaceHoles(doc) {
  schedule("holes", () => {
    if (!doc) {
      removeDoc(HOLES_KEY);
      return true;
    }
    return writeDoc(HOLES_KEY, serializeHolesDoc(doc));
  });
}

/**
 * The stored Holes document, checked against the live catalogue and the
 * mesh gate, or null when there is none (or it no longer loads — a part
 * deleted from the catalogue, a damaged mesh). A problem is logged and
 * the entry dropped so every launch doesn't warn about it again.
 * @param {Map<string, any>} catalogueById
 */
export function restoreWorkspaceHoles(catalogueById) {
  const doc = readDoc(HOLES_KEY);
  if (!doc) return null;
  try {
    return holesDocFromSaved(doc, catalogueById);
  } catch (err) {
    console.warn("Workspace: couldn't restore the Holes tab:", err);
    removeDoc(HOLES_KEY);
    return null;
  }
}

function holesDocFromSaved(doc, catalogueById) {
  const source = sourceFromSaved(doc.source, catalogueById);
  if (!Array.isArray(doc.holes)) throw new Error("its holes aren't a list");
  const holes = [];
  const ids = new Set();
  for (const saved of doc.holes) {
    const hole = holeFromSaved(saved);
    // One damaged hole doesn't cost the model the others: it is dropped,
    // as a saved config's unknown parts are refused rather than repaired.
    if (!hole || ids.has(hole.id)) continue;
    ids.add(hole.id);
    holes.push(hole);
  }
  return {
    source,
    holes,
    name: typeof doc.name === "string" ? doc.name : null,
    nextSpec: normalizeSpec(doc.nextSpec),
    nextPresetId: typeof doc.nextPresetId === "string" ? doc.nextPresetId : null,
  };
}

function sourceFromSaved(source, catalogueById) {
  if (!isObject(source)) throw new Error("it has no base model");
  if (source.kind === "catalogue") {
    if (typeof source.partId !== "string") throw new Error("its catalogue part has no id");
    if (!catalogueById.has(source.partId)) throw new Error(`part "${source.partId}" isn't in the catalogue`);
    if (!isParamSet(source.params)) throw new Error(`part "${source.partId}" has unusable parameters`);
    return { kind: "catalogue", partId: source.partId, params: { ...source.params } };
  }
  if (source.kind === "mesh") {
    if (typeof source.name !== "string" || typeof source.stl !== "string" || typeof source.flip !== "boolean")
      throw new Error("its mesh source is incomplete");
    const validation = validateAndRepair(new STLLoader().parse(base64ToBytes(source.stl)));
    if (!validation.ok) throw new Error(`its mesh didn't pass validation: ${validation.report.join(" ")}`);
    // The raw geometry is what was saved; meshSource() grounds it (and
    // turns it over for a flipped source) exactly as the original import.
    return meshSource(source.name, validation.geometry, source.flip);
  }
  throw new Error(`it has an unknown base model "${source.kind}"`);
}

function holeFromSaved(saved) {
  if (!isObject(saved) || typeof saved.id !== "string" || !saved.id) return null;
  if (!isVec3(saved.point) || !isVec3(saved.normal)) return null;
  const length = Math.hypot(...saved.normal);
  if (!(length > 0)) return null;
  return {
    id: saved.id,
    point: [...saved.point],
    normal: saved.normal.map((n) => n / length),
    spec: normalizeSpec(saved.spec),
    presetId: typeof saved.presetId === "string" ? saved.presetId : null,
  };
}

function isVec3(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
