// Tessellates STEP files off the main thread. occt-import-js is
// OpenCASCADE's STEP reader and BRepMesh compiled to WebAssembly (a 7.6 MB
// .wasm, so it is only ever fetched here, and only once someone imports a
// STEP file). The glue's Node-only branches `require()` path and crypto;
// Vite externalises those for the browser build with a warning each, and
// the branches never run in a worker. Unlike openscad-wasm, one instance can be called any number of
// times, so the module is created once and kept for the worker's life;
// the first import pays for the compile, later ones don't.
//
// Protocol (see src/lib/stepImport.js): { id, bytes: ArrayBuffer } in,
// { id, type: "result", bodies } or { id, type: "error", message } out.
// `bodies` is stepMesh.js's shape with each `positions` buffer
// transferred, not copied.
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { STEP_TESSELLATION, bodiesFromOcct } from "../lib/stepMesh.js";

let occtPromise = null;

function occt() {
  if (!occtPromise) {
    // `locateFile` is how the Emscripten glue finds its .wasm; Vite
    // hashes the asset's name at build time, so the glue's default
    // (same directory as the script) would miss it.
    occtPromise = occtimportjs({ locateFile: () => wasmUrl });
    // A failed load (offline, blocked fetch) is not cached: the next
    // import retries instead of failing forever with a stale rejection.
    occtPromise.catch(() => { occtPromise = null; });
  }
  return occtPromise;
}

self.onmessage = async (event) => {
  const { id, bytes } = event.data;
  try {
    const module = await occt();
    const result = module.ReadStepFile(new Uint8Array(bytes), { ...STEP_TESSELLATION });
    const bodies = bodiesFromOcct(result);
    self.postMessage({ id, type: "result", bodies }, bodies.map((b) => b.positions.buffer));
  } catch (err) {
    self.postMessage({ id, type: "error", message: err?.message ?? String(err) });
  }
};
