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

// `buffer`: the file's ArrayBuffer. It is transferred to the worker, so
// the caller's copy is empty afterwards. Resolves with
// [{ name, positions, triangleCount, extents }] (see stepMesh.js).
export function tessellateStep(buffer) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, bytes: buffer }, [buffer]);
  });
}
