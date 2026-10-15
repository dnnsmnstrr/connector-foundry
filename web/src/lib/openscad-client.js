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

// "Is anything rendering right now?" for the shell's progress indicator
// (hooks/useRenderActivity.js). Derived from inFlight — every render
// from every screen (Library, the Bench's assembly and per-node extents,
// an export) passes through renderPart(), so this is complete without
// any screen having to report its own status. Cache hits never enter
// inFlight, so they don't flicker the indicator either.
const activityListeners = new Set();

function notifyActivity() {
  for (const listener of activityListeners) listener();
}

export function getRenderActivity() {
  return inFlight.size;
}

export function subscribeRenderActivity(listener) {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

// Keep the queue on the main thread: a worker inside synchronous WASM
// cannot receive a cancellation message. Only one job is posted at a
// time; terminating its worker is the way to interrupt an active render.
const RENDER_TIMEOUT_MS = 120_000;
let active = null;

function stopWorker() {
  worker?.terminate();
  worker = null;
}

function finish(job, error, stl) {
  if (!pending.has(job.id)) return;
  clearTimeout(job.timer);
  pending.delete(job.id);
  inFlight.delete(job.key);
  if (active === job) active = null;
  if (!error) store(job.key, stl);
  for (const consumer of job.consumers) {
    consumer.cleanup();
    if (error) consumer.reject(error);
    else consumer.resolve(stl);
  }
  job.consumers.clear();
  notifyActivity();
  queueMicrotask(pump);
}

function onWorkerMessage(event) {
  const { id, type } = event.data;
  if (type === "log") {
    console.error("[openscad]", event.data.text);
    return;
  }
  const job = pending.get(id);
  if (!job || job !== active) return;
  finish(job, type === "result" ? null : new Error(event.data.message), event.data.stl);
}

function getWorker() {
  if (!worker) {
    const created = new Worker(new URL("../worker/openscad-worker.js", import.meta.url), { type: "module" });
    worker = created;
    created.onmessage = (event) => {
      if (worker === created) onWorkerMessage(event);
    };
    const fail = (detail) => {
      if (worker !== created) return;
      stopWorker();
      if (active) finish(active, new Error(`OpenSCAD worker failed: ${detail}`));
    };
    created.onerror = (event) => fail(event.message || "script error");
    created.onmessageerror = () => fail("message could not be deserialised");
  }
  return worker;
}

function pump() {
  if (active || pending.size === 0) return;
  const job = pending.values().next().value;
  active = job;
  job.timer = setTimeout(() => {
    stopWorker();
    finish(
      job,
      new Error("OpenSCAD render timed out after 2 minutes. Try simpler parameters or render again."),
    );
  }, RENDER_TIMEOUT_MS);
  try {
    // Clone imported buffers: exports and later previews still need them.
    getWorker().postMessage({ ...job.request, id: job.id });
  } catch (err) {
    stopWorker();
    finish(job, err);
  }
}

function abortError() {
  return new DOMException("Render cancelled", "AbortError");
}

// Explicit user cancellation includes exports. Automatic preview cleanup
// only removes that preview's subscription, preserving any export that
// happens to need the same mesh.
export function cancelRenders() {
  stopWorker();
  for (const job of [...pending.values()]) finish(job, abortError());
}

function sortedEntries(obj) {
  return Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b));
}

// A digest of an imported mesh's bytes, memoised per buffer object.
// The generated source only names a mesh by its mount path
// (imports/<name stem>.stl), so two different meshes with the same name
// — a revised bracket.stl, "Use current bench" after the bench changed —
// produce identical source and would otherwise replay the old render.
// Content rather than object identity, so the same bytes decoded again
// (a reloaded session) still hit; memoised, because the key is rebuilt
// on every edit and hashing a multi-megabyte mesh each time would undo
// the work benchConfig.js does to avoid touching those buffers. Callers
// never mutate a mesh's bytes in place (every revision is a new buffer),
// which is what makes the memo safe. Two independent 32-bit FNV-style
// hashes plus the length keep an accidental collision out of reach.
/** @type {WeakMap<object, string>} */
const digestByBuffer = new WeakMap();

/** @param {ArrayBuffer | ArrayBufferView} bytes */
export function bytesDigest(bytes) {
  let digest = digestByBuffer.get(bytes);
  if (digest) return digest;
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < view.length; i++) {
    h1 = Math.imul(h1 ^ view[i], 0x01000193);
    h2 = Math.imul(h2 ^ view[i], 0x5bd1e995) ^ (h2 >>> 15);
  }
  const hex = (/** @type {number} */ h) => (h >>> 0).toString(16).padStart(8, "0");
  digest = `${view.length}:${hex(h1)}${hex(h2)}`;
  digestByBuffer.set(bytes, digest);
  return digest;
}

function importedDigests(importedFiles) {
  return [...(importedFiles ?? [])]
    .map(([path, bytes]) => [path, bytesDigest(bytes)])
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * A part render passes scadFile/module/params, an assembly scadSource
 * (with part, importedFiles); globalOverrides goes with either.
 * @param {{
 *   scadFile?: string,
 *   module?: string,
 *   params?: Record<string, any>,
 *   scadSource?: string,
 *   part?: string,
 *   globalOverrides?: Record<string, any>,
 *   importedFiles?: Iterable<[string, Uint8Array]>,
 * }} request
 */
export function renderRequestKey({
  scadFile,
  module,
  params,
  scadSource,
  part,
  globalOverrides,
  importedFiles,
}) {
  // globalOverrides folded in so a FIT_CLEARANCE change actually
  // busts the cache instead of replaying a stale mesh rendered under
  // the old value.
  const globals = sortedEntries(globalOverrides);
  if (scadSource) {
    return JSON.stringify(["assembly", scadSource, part ?? "all", globals, importedDigests(importedFiles)]);
  }
  // Sorted, so two parameter objects that differ only in key order —
  // which JSON.stringify would otherwise distinguish — share an entry.
  return JSON.stringify([scadFile, module, sortedEntries(params), globals]);
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
  const key = renderRequestKey(request);
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

// Callers own their subscription through an AbortSignal. A replaced
// preview unsubscribes on effect cleanup; jobs with no remaining callers
// are removed before they can block the latest preview. Exports omit the
// signal and survive edits, tab changes, and other preview cancellations.
/**
 * @param {object} request
 * @param {{ signal?: AbortSignal }} [options]
 */
export function renderPart(request, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  const cached = getCachedRender(request);
  if (cached) return Promise.resolve(cached);

  const key = renderRequestKey(request);
  let job = inFlight.get(key);
  if (!job) {
    job = { id: nextId++, key, request, consumers: new Set(), timer: null };
    inFlight.set(key, job);
    pending.set(job.id, job);
  }
  const promise = new Promise((resolve, reject) => {
    const consumer = { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) };
    function abort() {
      consumer.cleanup();
      job.consumers.delete(consumer);
      reject(abortError());
      if (job.consumers.size === 0) {
        if (active === job) stopWorker();
        finish(job, abortError());
      }
    }
    job.consumers.add(consumer);
    signal?.addEventListener("abort", abort, { once: true });
  });
  notifyActivity();
  queueMicrotask(pump);
  return promise;
}
