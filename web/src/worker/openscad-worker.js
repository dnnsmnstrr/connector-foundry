// Runs OpenSCAD (WASM, Manifold backend) off the main thread.
//
// This build's WASM instance can only safely run `callMain` once — a
// second call on the same instance aborts with an opaque numeric
// exception (verified against openscad-wasm@0.0.4). So every render
// spins up a fresh instance and re-mounts the source bundle; the
// bundle fetch itself is cached across renders since it's just data.
import { createOpenSCAD } from "openscad-wasm";

let bundlePromise = null;

function getBundle() {
  if (!bundlePromise) {
    bundlePromise = fetch("/scad-bundle.json").then((res) => res.json());
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

self.onmessage = async (event) => {
  const { id, scadFile, module, params } = event.data;
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

    const args = Object.entries(params || {})
      .map(([key, value]) => `${key}=${scadLiteral(value)}`)
      .join(", ");
    const mainScad = `include </repo/${scadFile}>\n${module}(${args});\n`;
    os.FS.writeFile("/main.scad", mainScad);

    const rc = os.callMain(["/main.scad", "-o", "/output.stl", "--backend=Manifold"]);
    if (rc !== 0) {
      throw new Error("OpenSCAD render failed — check the parameters (see worker console for details)");
    }
    const stl = os.FS.readFile("/output.stl", { encoding: "binary" });
    const stlCopy = stl.slice().buffer;
    postMessage({ id, type: "result", stl: stlCopy }, [stlCopy]);
  } catch (err) {
    postMessage({ id, type: "error", message: err?.message || String(err) });
  }
};
