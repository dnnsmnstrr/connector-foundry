// Everything the app keeps in localStorage, as one file: Settings →
// "Export settings…" writes it, "Import settings…" reads it back, so
// presets, saved part defaults and preferences can move to another
// machine or browser, or be kept as a backup.
//
// Every key this app stores starts with "connector-foundry." (uiPrefs.js)
// or "connector-foundry:" (userOverrides.js, benchPresets.js), so the
// backup is that prefix rather than a list of keys — a preference added
// later is in it without anyone remembering to add it here. Values are
// copied as the raw strings each module wrote, never reinterpreted: each
// module already validates what it reads, so a stale or hand-edited
// value degrades the same way it would had it never left storage.
// sessionStorage (one tab's imported meshes) is not settings and stays out.
//
// An import replaces: the app's keys that the file doesn't have are
// removed, so the result is exactly the exported state. It is all or
// nothing — if a write fails (a file with large presets can exceed the
// browser's ~5 MB) the previous values are put back. The caller reloads
// the page afterwards, so every module re-reads storage from scratch
// instead of each needing its own "reload" hook.
export const SETTINGS_FORMAT = "connector-foundry-settings";
export const SETTINGS_VERSION = 1;
export const SETTINGS_EXTENSION = ".settings.json";

export function isAppKey(key) {
  return typeof key === "string" && (key.startsWith("connector-foundry.") || key.startsWith("connector-foundry:"));
}

function appKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (isAppKey(key)) keys.push(key);
  }
  return keys.sort();
}

// The document to save; `entries` is { key: rawString }.
export function exportSettings(storage = window.localStorage) {
  const entries = {};
  for (const key of appKeys(storage)) {
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return { format: SETTINGS_FORMAT, version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), entries };
}

export function settingsToJson(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Checks a file's text and returns its entries; throws with a message
// meant for the user. Keys outside the app's prefix are dropped rather
// than refused, so a file can never write into another app's storage.
export function parseSettings(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("it isn't a JSON file.");
  }
  if (!doc || typeof doc !== "object" || doc.format !== SETTINGS_FORMAT) {
    throw new Error("it isn't a Connector Foundry settings file.");
  }
  if (!Number.isInteger(doc.version) || doc.version > SETTINGS_VERSION) {
    throw new Error("it was made by a newer version of Connector Foundry. Update the app, then import it again.");
  }
  if (!doc.entries || typeof doc.entries !== "object" || Array.isArray(doc.entries)) {
    throw new Error("it has no settings in it.");
  }
  const entries = {};
  for (const [key, value] of Object.entries(doc.entries)) {
    if (isAppKey(key) && typeof value === "string") entries[key] = value;
  }
  return entries;
}

// Replaces the app's stored state with `entries`. Returns null on
// success, else a message for the user (and storage is as it was).
export function applySettings(entries, storage = window.localStorage) {
  const previous = {};
  try {
    for (const key of appKeys(storage)) previous[key] = storage.getItem(key);
  } catch {
    return "This browser isn't letting the app use its storage, so there is nowhere to import into.";
  }
  try {
    for (const key of Object.keys(previous)) if (!(key in entries)) storage.removeItem(key);
    for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
    return null;
  } catch (err) {
    try {
      for (const key of appKeys(storage)) if (!(key in previous)) storage.removeItem(key);
      for (const [key, value] of Object.entries(previous)) storage.setItem(key, value);
    } catch {
      // best-effort — restoring smaller values than were there can't overflow
    }
    return err?.name === "QuotaExceededError"
      ? "The settings file is too large for this browser's storage (presets with imported meshes are the usual cause). Nothing was changed."
      : "The settings couldn't be saved. Nothing was changed.";
  }
}
