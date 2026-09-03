// Saved bench setups, kept in the browser: a named list of the same
// documents benchConfig.js writes to a file, so "save as preset" and
// "download config" are one serialisation with two destinations, and a
// preset can always be turned into a file (and a file into a preset)
// without conversion.
//
// localStorage-backed, best-effort like userOverrides.js and uiPrefs.js —
// every read is wrapped so a private window or blocked storage degrades
// to "no presets". A write can ALSO fail for a reason worth telling the
// user about: a config embeds its imported STL meshes (see
// benchConfig.js), and one big mesh can exceed the ~5 MB a browser
// allows one origin. savePreset() therefore returns an error message
// instead of failing silently — the caller shows it and suggests the
// file export, which has no such limit.
//
// One cached snapshot + a listener set, the same shape as uiPrefs.js's
// system order, so the Bench reads the list through useSyncExternalStore
// (hooks/useBenchPresets.js) and every panel showing presets updates the
// moment one is saved or deleted.
const STORAGE_KEY = "connector-foundry:benchPresets";

let cache;
const listeners = new Set();

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === "string" && p.config && typeof p.config === "object");
  } catch {
    return [];
  }
}

// [{ name, savedAt, config }], sorted by name — a stable array until the
// next write, which is what useSyncExternalStore needs.
export function listPresets() {
  if (cache === undefined) cache = read();
  return cache;
}

function commit(next) {
  const sorted = [...next].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch (err) {
    return storageErrorMessage(err);
  }
  cache = sorted;
  for (const listener of listeners) listener();
  return null;
}

// Saves (or, for an existing name, replaces) a preset. Returns null on
// success, else a message for the user.
export function savePreset(name, config) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "Give the preset a name first.";
  const entry = { name: trimmed, savedAt: new Date().toISOString(), config };
  const rest = listPresets().filter((p) => p.name.localeCompare(trimmed, undefined, { sensitivity: "base" }) !== 0);
  return commit([...rest, entry]);
}

export function deletePreset(name) {
  return commit(listPresets().filter((p) => p.name !== name));
}

export function getPreset(name) {
  return listPresets().find((p) => p.name === name) ?? null;
}

export function subscribePresets(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storageErrorMessage(err) {
  const quota = err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_QUOTA_REACHED" || err?.code === 22 || err?.code === 1014;
  if (quota) {
    return "Browser storage is full — a preset embeds its imported STL meshes, and this one doesn't fit. " +
      "Download it as a config file instead, or delete a preset to make room.";
  }
  return "This browser isn't letting the app save presets (private window, or storage blocked).";
}
