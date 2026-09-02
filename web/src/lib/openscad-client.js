// Promise wrapper around the OpenSCAD worker: one in-flight request per
// id, resolved/rejected when the matching worker message arrives.
//
// Results are memoised for RENDER_TTL_MS, keyed on the exact
// (file, module, parameters) triple. A render is expensive — the worker
// spins up a fresh WASM instance and re-mounts the source bundle every
// time — so switching between two parts, or stepping back to parameters
// tried a moment ago, should not pay for it twice. Entries expire so a
// long session doesn't pin every mesh it ever produced in memory.
const RENDER_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

let worker = null;
let nextId = 1;
const pending = new Map();
const cache = new Map();
const inFlight = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("../worker/openscad-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, type } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (type === "result") entry.resolve(event.data.stl);
      else entry.reject(new Error(event.data.message));
    };
  }
  return worker;
}

function cacheKey({ scadFile, module, params, scadSource, part }) {
  if (scadSource) return JSON.stringify(["assembly", scadSource, part ?? "all"]);
  // Sorted, so two parameter objects that differ only in key order —
  // which JSON.stringify would otherwise distinguish — share an entry.
  const entries = Object.entries(params || {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([scadFile, module, entries]);
}

function store(key, stl) {
  cache.set(key, { stl, expires: Date.now() + RENDER_TTL_MS });

  let bytes = 0;
  for (const [k, entry] of cache) {
    if (entry.expires <= Date.now()) cache.delete(k);
    else bytes += entry.stl.byteLength;
  }
  // Map iterates in insertion order and every hit re-inserts its entry,
  // so the front of the map is the least recently used. Keep at least
  // the entry just stored, however big it is — it's the one on screen.
  while (bytes > MAX_CACHE_BYTES && cache.size > 1) {
    const [oldestKey, oldest] = cache.entries().next().value;
    cache.delete(oldestKey);
    bytes -= oldest.stl.byteLength;
  }
}

// Synchronous lookup, so a caller can swap in an already-rendered mesh
// without flashing a "rendering" state for work that won't happen.
// The returned ArrayBuffer is shared with every other hit on the same
// key: read it (three.js parsing, `new Blob([...])`) but never transfer
// or mutate it.
export function getCachedRender(request) {
  const key = cacheKey(request);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry); // move to the back: most recently used
  return entry.stl;
}

export function renderPart(request) {
  const cached = getCachedRender(request);
  if (cached) return Promise.resolve(cached);

  // Two renders of the same thing can overlap if the user clicks around
  // while one is running; the second waits on the first instead.
  const key = cacheKey(request);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const { scadFile, module, params, scadSource, part } = request;
  const id = nextId++;
  const w = getWorker();
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, scadFile, module, params, scadSource, part });
  }).then(
    (stl) => {
      inFlight.delete(key);
      store(key, stl);
      return stl;
    },
    (err) => {
      inFlight.delete(key);
      throw err;
    },
  );
  inFlight.set(key, promise);
  return promise;
}
