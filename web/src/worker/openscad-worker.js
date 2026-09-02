// Runs OpenSCAD (WASM, Manifold backend) off the main thread.
//
// This build's WASM instance can only safely run `callMain` once — a
// second call on the same instance aborts with an opaque numeric
// exception (verified against openscad-wasm@0.0.4). So every render
// spins up a fresh instance and re-mounts the source bundle; the
// bundle fetch itself is cached across renders since it's just data.
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

function getBundle() {
  if (!bundlePromise) {
    bundlePromise = fetchPublic("scad-bundle.json")
      .then((res) => res.json())
      .catch((err) => {
        // Don't cache the failure: a transient network error on the very
        // first render would otherwise fail every later one too.
        bundlePromise = null;
        throw err;
      });
  }
  return bundlePromise;
}

function mkdirp(fsobj, dirPath) {
  const parts = dirPath.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    try {
      fsobj.mkdir(cur);
    } catch {
      // already exists
    }
  }
}

function writeFileAt(fsobj, virtualPath, content) {
  mkdirp(fsobj, virtualPath.slice(0, virtualPath.lastIndexOf("/")));
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
// their repo-relative paths.
function mountBundle(fsobj, bundle) {
  for (const [relPath, content] of Object.entries(bundle.files)) {
    writeFileAt(fsobj, `${REPO_MOUNT}/${relPath}`, content);
  }
  for (const [relPath, base64] of Object.entries(bundle.assets ?? {})) {
    writeFileAt(fsobj, `${REPO_MOUNT}/${relPath}`, base64ToBytes(base64));
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

    const rc = os.callMain([mainPath, "-o", "/output.stl", "--backend=Manifold", ...extraArgs]);
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
