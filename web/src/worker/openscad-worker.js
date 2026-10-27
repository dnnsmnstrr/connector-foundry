// Runs OpenSCAD (WASM, Manifold backend) off the main thread. The render
// itself — a fresh instance per render, the bundle mounted, callMain() —
// is src/lib/openscadRun.js's runOpenscad(), which openscad-client.js
// also runs on the main thread when a render here runs out of stack.
//
// Two renders also can't safely run CONCURRENTLY: two `createOpenSCAD()`
// calls in flight at once corrupts something shared at module scope in
// this build (surfaced as an opaque "table index is out of bounds" WASM
// trap on one or both — a Bench render fires an individual root-extents
// render and the combined-assembly render close together, which was
// enough to hit this). So every request goes through one FIFO queue;
// each render still resolves/rejects independently, only the underlying
// work is serialized.
//
// Besides renders, the queue takes a `{ type: "warm" }` message from
// openscad-client.js (see its warm-up notes): the set-up half of a render
// with nothing rendered, so a worker started while the user is idle has
// its bundle decoded and its WebAssembly module compiled before the first
// real request arrives. It answers nothing; see warmOnce().
import { runOpenscad, warmOpenscad } from "../lib/openscadRun.js";

let queue = Promise.resolve();
// How many queued jobs have not started yet; warmOnce() checks it.
let waiting = 0;
function enqueue(work) {
  waiting++;
  const result = queue.then(() => {
    waiting--;
    return work();
  });
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

// The warm-up goes through the same queue as the renders, not ahead of
// it: the client posts renders to a worker that may still be warming (a
// boot warm-up, then the first part picked), and a render's
// createOpenSCAD() running alongside the warm-up's is exactly the
// concurrent pair the header describes.
self.onmessage = (event) => {
  enqueue(() => (event.data?.type === "warm" ? warmOnce() : renderOne(event.data)));
};

// Fetches and decodes the bundle and compiles the WebAssembly module
// (warmOpenscad()), without rendering anything.
//
// The instance is skipped when a render arrived while the bundle loaded.
// That render creates its own straight after, compiling the module
// itself, and a throwaway instance ahead of it only holds it up: measured
// on a render posted right behind a warm-up, +17-49 ms in Chromium and
// +29-35 ms in Node without the skip, nothing with it.
//
// Nothing is posted back, success or failure: the client holds no job
// for a warm-up. A failure is swallowed rather than thrown so it cannot
// surface as an unhandled rejection; its cause (the bundle 404ing, say)
// recurs on the next render, which reports it.
async function warmOnce() {
  try {
    await warmOpenscad(() => waiting > 0);
  } catch {
    // See above: the next render reports the same failure.
  }
}

async function renderOne({ id, ...request }) {
  try {
    const stl = await runOpenscad(request, {
      onError: (text) => postMessage({ type: "log", level: "error", text }),
    });
    postMessage({ id, type: "result", stl: stl.buffer }, [stl.buffer]);
  } catch (err) {
    postMessage({ id, type: "error", message: err?.message || String(err) });
  }
}
