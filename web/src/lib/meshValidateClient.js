// Main-thread side of the import gate: hands a raw mesh to
// src/worker/mesh-worker.js, which runs meshValidate.js's
// validateAndRepair() there, and resolves with the same result. The worker
// is created on the first import and kept (a second import is just a
// message), and requests are matched to replies by id, as stepImport.js
// does for the STEP reader.
//
// Where no worker can run the gate (no Worker at all, as in Node; one that
// fails to start or dies), it runs here instead, on the main thread, as it
// always did before: slower to the eye, never a failed import. A worker
// that died is dropped, so the next import tries a fresh one.
import { validateAndRepair, validationFromMessage } from "./meshValidate.js";

/** @type {Worker | null} */
let worker = null;
let nextId = 1;
/** @type {Map<number, { resolve: (v: any) => void, fallback: () => void }>} */
const pending = new Map();

// Every request still waiting falls back to the main thread, and the next
// import starts a fresh worker.
function fail() {
  const waiting = [...pending.values()];
  pending.clear();
  worker?.terminate();
  worker = null;
  for (const request of waiting) request.fallback();
}

function ensureWorker() {
  if (worker) return worker;
  const created = new Worker(new URL("../worker/mesh-worker.js", import.meta.url), { type: "module" });
  worker = created;
  created.onmessage = (event) => {
    const { id, type } = event.data ?? {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    // An error in the worker is an error validateAndRepair() threw: the
    // main thread would throw the same, so it is run there to say so in
    // the caller's own words.
    // A reply that isn't the worker's shape is no answer either.
    if (type === "result" && event.data.position instanceof Float32Array) {
      request.resolve(validationFromMessage(event.data));
    } else request.fallback();
  };
  created.onerror = () => fail();
  created.onmessageerror = () => fail();
  return created;
}

/**
 * validateAndRepair() for `rawGeometry` (a non-indexed or indexed
 * BufferGeometry with a position attribute), in the worker when there is
 * one. The geometry's arrays are copied, not transferred: the caller's
 * geometry is left as it was.
 * @param {import("three").BufferGeometry} rawGeometry
 * @returns {Promise<ReturnType<typeof validateAndRepair>>}
 */
export function validateAndRepairAsync(rawGeometry) {
  const onMainThread = () => validateAndRepair(rawGeometry);
  if (typeof Worker === "undefined") return Promise.resolve().then(onMainThread);
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try {
        resolve(onMainThread());
      } catch (err) {
        reject(err);
      }
    };
    const id = nextId++;
    try {
      const source = rawGeometry.attributes.position.array;
      // slice() is a straight copy; from() would walk it element by element.
      const position =
        source instanceof Float32Array
          ? source.slice()
          : Float32Array.from(/** @type {ArrayLike<number>} */ (source));
      const index = rawGeometry.index ? rawGeometry.index.array.slice() : null;
      const transfer = [position.buffer, ...(index ? [index.buffer] : [])];
      const target = ensureWorker();
      pending.set(id, { resolve, fallback });
      target.postMessage({ id, position, index }, transfer);
    } catch {
      // A worker that could not be created (a strict CSP, an old browser
      // without module workers) or a post that failed: no reply will come.
      // Anything else waiting on that worker falls back with it.
      pending.delete(id);
      fail();
      fallback();
    }
  });
}
