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
    bundlePromise = fetch(`${import.meta.env.BASE_URL}scad-bundle.json`).then((res) => res.json());
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

function mountBundle(fsobj, bundle) {
  for (const [relPath, content] of Object.entries(bundle)) {
    const virtualPath = "/repo/" + relPath;
    mkdirp(fsobj, virtualPath.slice(0, virtualPath.lastIndexOf("/")));
    fsobj.writeFile(virtualPath, content);
  }
}

function scadLiteral(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

self.onmessage = (event) => {
  enqueue(() => renderOne(event.data));
};

async function renderOne({ id, scadFile, module, params, scadSource, part }) {
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

    // Two request shapes: a single catalogue part (scadFile + module +
    // params -> `include <..>; module(args);`), or a fully generated
    // source (scadSource) for a Bench assembly — see
    // web/src/lib/assembly.js's compileToScad(). The generated source
    // uses assemblies/*.scad's own include convention (`../vendor/...`
    // etc.), so it's mounted at that same depth for its relative
    // includes to resolve, and it's also the literal file a "download
    // .scad" export would hand someone to drop into assemblies/.
    let mainPath, extraArgs = [];
    if (scadSource) {
      mainPath = "/repo/assemblies/_bench.scad";
      mkdirp(os.FS, "/repo/assemblies");
      os.FS.writeFile(mainPath, scadSource);
      if (part) extraArgs = ["-D", `part=${scadLiteral(part)}`];
    } else {
      const args = Object.entries(params || {})
        .map(([key, value]) => `${key}=${scadLiteral(value)}`)
        .join(", ");
      mainPath = "/main.scad";
      os.FS.writeFile(mainPath, `include </repo/${scadFile}>\n${module}(${args});\n`);
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
