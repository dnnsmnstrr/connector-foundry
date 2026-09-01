// Promise wrapper around the OpenSCAD worker: one in-flight request per
// id, resolved/rejected when the matching worker message arrives.
let worker = null;
let nextId = 1;
const pending = new Map();

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

export function renderPart({ scadFile, module, params }) {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, scadFile, module, params });
  });
}
