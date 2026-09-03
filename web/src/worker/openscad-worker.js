// Runs OpenSCAD (WASM, Manifold backend) off the main thread.
//
// This build's WASM instance can only safely run `callMain` once — a
// second call on the same instance aborts with an opaque numeric
// exception (verified against openscad-wasm@0.0.4). So every render
// spins up a fresh instance and re-mounts the source bundle; the
// bundle itself is fetched — and decoded to bytes, see prepareBundle()
// — once, since it's just data.
//
// Two renders also can't safely run CONCURRENTLY: two `createOpenSCAD()`
// calls in flight at once corrupts something shared at module scope in
// this build (surfaced as an opaque "table index is out of bounds" WASM
// trap on one or both — a Bench render fires an individual root-extents
// render and the combined-assembly render close together, which was
// enough to hit this). So every request goes through one FIFO queue;
// each render still resolves/rejects independently, only the underlying
// work is serialized.
import { createOpenSCAD } from "openscad-wasm";
import { fetchPublic } from "../lib/publicAsset.js";
import { callArgs, defineArgs, scadLiteral } from "../lib/scadLiteral.js";

// Where the source bundle is mounted inside the WASM filesystem. It
// mirrors the real repo layout because every .scad file here uses
// relative includes (`../../vendor/BOSL2/std.scad`), so the depth has to
// match for those to resolve.
const REPO_MOUNT = "/repo";
// A generated Bench assembly lives where assemblies/*.scad live, for the
// same reason — its includes use that directory's `../` convention, and
// it is the literal file a "download .scad" export hands someone to drop
// into assemblies/.
const BENCH_DIR = `${REPO_MOUNT}/assemblies`;
const BENCH_MAIN = `${BENCH_DIR}/_bench.scad`;

let queue = Promise.resolve();
function enqueue(work) {
  const result = queue.then(work);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

let bundlePromise = null;

// Resolves to the mounted-and-ready form of the bundle: [virtualPath,
// bytes] pairs (see prepareBundle()).
function getBundle() {
  if (!bundlePromise) {
    bundlePromise = fetchPublic("scad-bundle.json")
      .then((res) => res.json())
      .then(prepareBundle)
      .catch((err) => {
        // Don't cache the failure: a transient network error on the very
        // first render would otherwise fail every later one too.
        bundlePromise = null;
        throw err;
      });
  }
  return bundlePromise;
}

// Creates every missing directory on the way to `dirPath`. `made` (a Set
// of directories known to exist on this FS) lets a caller writing many
// files skip the mkdir-and-catch round trip for the ancestors every other
// file in the same directory has already been through.
function mkdirp(fsobj, dirPath, made) {
  if (made?.has(dirPath)) return;
  const parts = dirPath.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    if (made?.has(cur)) continue;
    try {
      fsobj.mkdir(cur);
    } catch {
      // already exists
    }
    made?.add(cur);
  }
}

function writeFileAt(fsobj, virtualPath, content, made) {
  mkdirp(fsobj, virtualPath.slice(0, virtualPath.lastIndexOf("/")), made);
  fsobj.writeFile(virtualPath, content);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// See sync-scad.mjs for the bundle shape: .scad sources as text under
// `files`, binaries a part import()s (base64) under `assets`, both at
// their repo-relative paths. Turned into [virtualPath, bytes] pairs ONCE,
// here, rather than on every mount: FS.writeFile() given a string runs
// Emscripten's own character-by-character UTF-8 encoder over it, which
// for ~5 MB of source was ~50 ms of every render; given bytes it just
// copies them, and mounting the same bundle takes ~3 ms.
function prepareBundle(bundle) {
  const encoder = new TextEncoder();
  const entries = [];
  for (const [relPath, content] of Object.entries(bundle.files)) {
    entries.push([`${REPO_MOUNT}/${relPath}`, encoder.encode(content)]);
  }
  for (const [relPath, base64] of Object.entries(bundle.assets ?? {})) {
    entries.push([`${REPO_MOUNT}/${relPath}`, base64ToBytes(base64)]);
  }
  return entries;
}

// A fresh FS per render, so the set of created directories is per call.
function mountBundle(fsobj, entries) {
  const made = new Set();
  for (const [virtualPath, bytes] of entries) {
    writeFileAt(fsobj, virtualPath, bytes, made);
  }
}

self.onmessage = (event) => {
  enqueue(() => renderOne(event.data));
};

async function renderOne({ id, scadFile, module, params, scadSource, part, importedFiles, globalOverrides }) {
  try {
    const bundle = await getBundle();
    const instance = await createOpenSCAD({
      print: () => {},
      printErr: (text) => {
        if (/error/i.test(text)) postMessage({ type: "log", level: "error", text });
      },
    });
    const os = instance.getInstance();
    mountBundle(os.FS, bundle);

    // -D overrides that apply regardless of request shape: `part=` for
    // an assembly's body selector, plus any global settings (e.g.
    // FIT_CLEARANCE — see web/src/lib/userOverrides.js) as real -D
    // flags, which OpenSCAD honours over a plain top-level assignment
    // even when that assignment came from an included file (verified:
    // lib/constants.scad's FIT_CLEARANCE=0.15 is overridden by
    // `-D FIT_CLEARANCE=0.3` the same way for a native `openscad` run
    // as it is here) — same mechanism the CLI uses (run_openscad()).
    const extraArgs = [...(part ? ["-D", `part=${scadLiteral(part)}`] : []), ...defineArgs(globalOverrides)];

    // Two request shapes: a single catalogue part (scadFile + module +
    // params -> `include <..>; module(args);`), or a fully generated
    // source (scadSource) for a Bench assembly — see
    // web/src/lib/assembly.js's compileToScad().
    let mainPath;
    if (scadSource) {
      mainPath = BENCH_MAIN;
      writeFileAt(os.FS, mainPath, scadSource);
      // Imported STL files (compileToScad() generates
      // `import("imports/<id>.stl")` inside the module it writes for
      // each one) — same relative resolution rule as the .scad tree
      // itself, so they're mounted next to _bench.scad.
      for (const [relPath, bytes] of importedFiles || []) {
        writeFileAt(os.FS, `${BENCH_DIR}/${relPath}`, new Uint8Array(bytes));
      }
    } else {
      mainPath = "/main.scad";
      os.FS.writeFile(mainPath, `include <${REPO_MOUNT}/${scadFile}>\n${module}(${callArgs(params)});\n`);
    }

    // Binary STL, not OpenSCAD's default ASCII: a fifth of the bytes for
    // the same triangles (the ASCII form spells every float out as text),
    // so the result copies to the main thread, sits in the render cache,
    // parses in three.js (a fixed-layout scan instead of a text scan) and
    // downloads faster. Vertices are float32 either way — OpenSCAD writes
    // its ASCII STL from the same single-precision values — so bounding
    // boxes and slot positions are bit-identical between the two.
    const rc = os.callMain([mainPath, "-o", "/output.stl", "--export-format=binstl", "--backend=Manifold", ...extraArgs]);
    if (rc !== 0) {
      throw new Error("OpenSCAD render failed — check the parameters (see worker console for details)");
    }
    const stl = os.FS.readFile("/output.stl", { encoding: "binary" });
    const stlCopy = stl.slice().buffer;
    postMessage({ id, type: "result", stl: stlCopy }, [stlCopy]);
  } catch (err) {
    postMessage({ id, type: "error", message: err?.message || String(err) });
  }
}
