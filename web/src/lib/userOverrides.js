// User-level persisted overrides — the browser side of the same
// three-layer resolution the CLI implements in cli/userconfig.py:
//
//     catalogue default -> saved user override -> this instance's value
//
// Backed by localStorage instead of a file (that's what a browser has),
// but the same Customizer-JSON shape (fileFormatVersion + parameterSets)
// as the CLI's saved files, under a reserved "user-default" preset name
// — so the two stay conceptually interchangeable even though nothing
// currently moves a saved set between them. A reserved pseudo part id,
// "__global__", holds cross-part settings (FIT_CLEARANCE) the same way
// cli/userconfig.py does, for the same reason: a printer-level override
// is the same kind of persisted preference as a per-part one.
//
// localStorage is best-effort: a private window, cleared site data, or
// some embedding contexts throw on first touch or come back empty.
// Every function here is wrapped so a failure degrades to "no saved
// overrides" rather than breaking the app.
const PRESET_NAME = "user-default";
const GLOBAL_ID = "__global__";

function storageKey(partId) {
  return `connector-foundry:overrides:${partId}`;
}

function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // best-effort — the save silently doesn't stick
  }
}

function safeRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function read(partId) {
  const raw = safeGet(storageKey(partId));
  if (!raw) return {};
  try {
    return JSON.parse(raw).parameterSets?.[PRESET_NAME] ?? {};
  } catch {
    return {};
  }
}

function write(partId, params) {
  const doc = { parameterSets: { [PRESET_NAME]: params }, fileFormatVersion: "1" };
  safeSet(storageKey(partId), JSON.stringify(doc));
}

export function getOverrides(partId) {
  return read(partId);
}

export function setOverrides(partId, params) {
  if (!params || Object.keys(params).length === 0) {
    clearOverrides(partId);
    return;
  }
  write(partId, params);
}

export function updateOverrides(partId, params) {
  const merged = { ...read(partId), ...params };
  write(partId, merged);
  return merged;
}

export function clearOverrides(partId, keys) {
  if (!keys) {
    safeRemove(storageKey(partId));
    return;
  }
  const remaining = { ...read(partId) };
  for (const k of keys) delete remaining[k];
  if (Object.keys(remaining).length) write(partId, remaining);
  else safeRemove(storageKey(partId));
}

export function getGlobalOverrides() {
  return read(GLOBAL_ID);
}

export function setGlobalOverrides(params) {
  setOverrides(GLOBAL_ID, params);
}

export function updateGlobalOverrides(params) {
  return updateOverrides(GLOBAL_ID, params);
}

export function clearGlobalOverrides(keys) {
  clearOverrides(GLOBAL_ID, keys);
}

// catalogue default -> saved user override -> instanceParams (usually
// {} — called once, when a part is first selected, to compute the
// starting point for that instance's editable param state). The one
// merge function Library and Bench both call, so their behaviour can't
// drift from each other or from the CLI's resolve_params() doing the
// same 3-way merge in cli/userconfig.py.
export function resolveParams(part, instanceParams) {
  return { ...(part.defaults ?? {}), ...getOverrides(part.id), ...instanceParams };
}
