// Promise wrapper around the OpenSCAD worker: one in-flight request per
// id, resolved/rejected when the matching worker message arrives.
import { isNativeStackOverflow } from "./renderError.js";

// Results are memoised, keyed on the exact (file, module, parameters)
// triple. A render is expensive — the worker spins up a fresh WASM
// instance and re-mounts the source bundle every time — so switching
// between two parts, or stepping back to parameters tried a moment ago,
// should not pay for it twice. The cache is bounded by bytes, least
// recently used first, and by nothing else: a time limit (five minutes,
// once) threw away work that still fit, and on the Bench every node's
// standalone render is an entry, so the first edit after a pause longer
// than that queued a render per node ahead of the one the edit was for —
// on a phone, where one render takes seconds, half a minute of waiting.
// A device that reports little memory (Chromium's deviceMemory; Safari
// says nothing and keeps the full cap) gets half the room.
const MAX_CACHE_BYTES =
  (typeof navigator !== "undefined" && /** @type {any} */ (navigator).deviceMemory <= 4 ? 32 : 64) *
  1024 *
  1024;

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
  if (type === "result") finish(job, null, event.data.stl);
  else if (isNativeStackOverflow(event.data.message)) renderOnMainThread(job);
  else finish(job, new Error(event.data.message));
}

// A render the worker ran out of native stack for, run again on the main
// thread, which has far more (renderError.js's isNativeStackOverflow()
// has the numbers; in practice this is Safari, whose workers fail most
// Bench assembly and Holes model otherwise). Same code as the worker
// (openscadRun.js), loaded only when first needed. The page freezes
// while OpenSCAD runs, which beats an error: the job stays active, so
// nothing else is posted to the worker meanwhile, and its deadline still
// applies up to the synchronous render. A job that was cancelled while
// the instance was set up is not rendered.
async function renderOnMainThread(job) {
  try {
    const { runOpenscad } = await import("./openscadRun.js");
    const stl = await runOpenscad(job.request, {
      onError: (text) => console.error("[openscad]", text),
      beforeRender: async () => {
        // Give the "Rendering…" status a frame to paint before the freeze.
        await new Promise((resolve) => {
          setTimeout(resolve, 50);
        });
        if (!pending.has(job.id)) throw abortError();
      },
    });
    finish(job, null, stl.buffer);
  } catch (err) {
    // Past the WASM module's own stack limit, the main thread's render
    // throws a bare number (a C++ exception pointer, seen in WebKit at
    // 100 nested levels). This render already overflowed one stack, so
    // say what it is: renderError.js then explains the nesting limit.
    finish(
      job,
      err instanceof Error || err instanceof DOMException
        ? err
        : new Error(`Maximum call stack size exceeded (OpenSCAD exception ${String(err)})`),
    );
  }
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

// Warm-up. A fresh worker has to load its script and the 10 MB OpenSCAD
// WebAssembly, fetch and decode the source bundle and compile the module
// before it can render. Measured in headless Chromium (dev server; a plate and a
// 2 x 2 Gridfinity base): a render posted to a fresh worker took
// 1040-1210 ms, the same render posted to one that had finished warming
// 495-600 ms, and the warm-up itself about 600 ms of the worker's time
// (none of the page's). An idle warmed worker holds a little less memory
// than the worker every session that has rendered already keeps (in
// Node, about 170 MB against 199 MB). So a fresh worker is started and
// sent `{ type: "warm" }` (the worker's warmOnce()) when none exists
// and nothing is pending:
// - once, after the app's first paint (main.jsx calls warmRenderer()),
//   for a landing on the Bench or Holes, whose first render waits for a
//   pick;
// - after a stop that interrupted a render: one the user moved past (an
//   abort) or one that ran out of time (warmAfterStop()). The next
//   edit's render usually follows a debounce later, which the warm-up
//   fills: 100-400 ms of idle saved 80-430 ms of that render. One posted
//   with no gap (a drag commit) costs nothing measurable, since
//   warmOnce() leaves the instance to a render already waiting.
// Never after fail(): a worker that cannot load at all (an old tab's
// hashed worker file gone after a deploy, a CSP block, offline) would
// respawn in a loop. Never after cancelRenders(): the user asked for the
// work to stop. A warm-up is not a job: it has no id, no deadline and no
// entry in inFlight, so getRenderActivity() never counts it; a render
// posted behind it waits in the worker's own queue, its 2-minute deadline
// running from when it was posted, as for any render.
/**
 * Starts a render worker and has it load what a render needs, so the
 * first render does not wait for that. Does nothing when a worker exists
 * or a render is pending, so a second call is harmless.
 */
export function warmRenderer() {
  if (worker || pending.size > 0) return;
  try {
    getWorker().postMessage({ type: "warm" });
  } catch {
    // The Worker could not be constructed or messaged. Drop it: the next
    // render creates one as it always has, and reports the failure.
    stopWorker();
  }
}

// One warm-up attempt per stop, deferred to a microtask so it sees the
// state after the whole synchronous pass that stopped the worker: an
// effect cleanup that aborts the Bench's active render and the ones
// queued behind it together, or a caller that requests its next render
// at once. A job still pending then gets the fresh worker from pump()
// (queued earlier by finish(), so it runs first), and warmRenderer()
// finds that worker and does nothing.
function warmAfterStop() {
  queueMicrotask(warmRenderer);
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
    warmAfterStop();
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
  cache.set(key, { stl });

  let bytes = 0;
  for (const entry of cache.values()) bytes += entry.stl.byteLength;
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
        const interrupted = active === job;
        if (interrupted) stopWorker();
        finish(job, abortError());
        if (interrupted) warmAfterStop();
      }
    }
    job.consumers.add(consumer);
    signal?.addEventListener("abort", abort, { once: true });
  });
  notifyActivity();
  queueMicrotask(pump);
  return promise;
}
