// Reuses openscad-wasm's compiled WebAssembly.Module across instances.
//
// openscad-wasm@0.0.4 ships its ~10 MB .wasm base64-inlined in
// openscad.js, and every createOpenSCAD() call runs its wasm() loader:
// atob() over the 13 MB string, a byte-by-byte copy into a Uint8Array,
// then WebAssembly.compile(). The render worker needs a fresh INSTANCE
// per render (src/worker/openscad-worker.js explains why), but the
// compiled MODULE is the same every time — WebAssembly.instantiate(
// module, imports) hands out a new instance with its own memory. Measured
// in headless Chrome: createOpenSCAD() took 40-105 ms per render before,
// 4-5 ms with the module memoised, on renders of 400-1500 ms.
//
// The package exports only createOpenSCAD(), which calls wasm()
// unconditionally, so the source itself is the one place to intervene.
// The rewrite renames the original wasm() and puts a memoising wrapper of
// the same name in front of it; nothing else in the file changes. A
// build FAILS if the expected line is not found exactly once, so an
// upstream update that reshapes the loader shows up as an error naming
// this file rather than as a silent return to recompiling every render.
//
// Listed under both `plugins` (dev server) and `worker.plugins` (the
// separate Rollup pass that bundles the worker for a build) in
// vite.config.js — a plugin in only the first list never sees the
// worker's imports at build time.
const NEEDLE = "\nfunction wasm(imports) {\n";
const WRAPPER =
  "\nlet __compiledWasm;\n" +
  "function wasm(imports) {\n" +
  "  if (!__compiledWasm) {\n" +
  "    __compiledWasm = __compileWasm(imports);\n" +
  "    // A failed compile is not cached, so the next render retries it.\n" +
  "    __compiledWasm.catch(() => { __compiledWasm = undefined; });\n" +
  "  }\n" +
  "  return __compiledWasm;\n" +
  "}\n" +
  "function __compileWasm(imports) {\n";

export default function openscadWasmMemoPlugin() {
  return {
    name: "openscad-wasm-memo",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]openscad-wasm[\\/]openscad\.js(\?.*)?$/.test(id)) return null;
      const at = code.indexOf(NEEDLE);
      if (at === -1 || code.indexOf(NEEDLE, at + 1) !== -1) {
        throw new Error(
          "openscad-wasm-memo: openscad-wasm's wasm() loader no longer looks as expected — " +
            "update or remove web/scripts/vite-plugin-openscad-wasm-memo.mjs",
        );
      }
      return { code: code.slice(0, at) + WRAPPER + code.slice(at + NEEDLE.length), map: null };
    },
  };
}
