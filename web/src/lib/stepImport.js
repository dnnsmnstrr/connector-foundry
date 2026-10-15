// Main-thread side of STEP tessellation: hands a file's bytes to
// src/worker/step-worker.js and resolves with stepMesh.js's bodies. The
// worker is created on the first STEP import (nothing about the 7.6 MB
// OpenCASCADE module is fetched before then) and kept — the reader can
// run any number of times in one instance, so a second import is just a
// message. One request runs at a time per worker; the UI only ever has
// one import flow open, so no queue is needed here, but requests are
// still matched to their reply by id rather than assumed in order.
//
// If the worker dies (a script error, an undeserialisable message),
// every pending request is rejected with a message saying so and the
// worker is dropped, so the next import starts a fresh one instead of
// waiting on a worker that will never answer — the same contract
// openscad-client.js keeps for the render worker.
let worker = null;
let nextId = 1;
const pending = new Map();

function fail(message) {
  const reason = new Error(`The STEP reader stopped (${message}). Try the import again.`);
  for (const { reject } of pending.values()) reject(reason);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function ensureWorker() {
  if (worker) return worker;
  const created = new Worker(new URL("../worker/step-worker.js", import.meta.url), { type: "module" });
  worker = created;
  created.onmessage = (event) => {
    const { id, type } = event.data ?? {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (type === "result") request.resolve(event.data.bodies);
    else request.reject(new Error(event.data.message || "unknown error"));
  };
  created.onerror = (event) => fail(event.message || "script error");
  created.onmessageerror = () => fail("message could not be deserialised");
  return created;
}

function abortError() {
  return new DOMException("STEP import cancelled", "AbortError");
}

// `buffer`: the file's ArrayBuffer. It is transferred to the worker, so
// the caller's copy is empty afterwards. Resolves with
// [{ name, positions, triangleCount, extents }] (see stepMesh.js).
//
// `options.signal`, optional: aborting it rejects the promise with an
// AbortError and terminates the worker — the reader is synchronous WASM
// and cannot be told to stop any other way — so the next import starts
// a fresh one. Any other request still pending on that worker is
// rejected as stopped, the same as a crash.
/**
 * @param {ArrayBuffer} buffer
 * @param {{ signal?: AbortSignal }} [options]
 */
export function tessellateStep(buffer, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(abortError());
      fail("cancelled");
    };
    const settle = (fn) => (value) => {
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      ensureWorker().postMessage({ id, bytes: buffer }, [buffer]);
    } catch (err) {
      // A failed post (a detached buffer, a worker that could not be
      // created) never reaches the worker, so no reply will ever remove
      // the entry: take it out here rather than leak it.
      pending.delete(id);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    }
  });
}
