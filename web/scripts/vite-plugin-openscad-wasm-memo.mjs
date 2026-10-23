// Serves openscad-wasm's WebAssembly as its own asset and reuses the
// compiled WebAssembly.Module across instances.
//
// openscad-wasm@0.0.4 ships its 10.3 MB .wasm base64-inlined in
// openscad.js, a 13.8 MB string literal, and every createOpenSCAD() call
// runs its wasm() loader: atob() over that string, a byte-by-byte copy
// into a Uint8Array, then WebAssembly.compile(). The package exports only
// createOpenSCAD(), which calls wasm() unconditionally, so the source
// itself is the one place to intervene. Two costs, so the loader is
// rewritten twice over:
//
// 1. The literal is cut out of the module, decoded once into
//    node_modules/.cache/openscad-wasm/openscad-<sha256 prefix>.wasm, and
//    imported back with Vite's `?url`, the way src/worker/step-worker.js
//    ships occt-import-js's binary: a build emits it as a hashed asset,
//    the dev server serves the cached file (see configureServer below).
//    The browser then downloads 10.3 MB of binary (3.2 MB gzipped)
//    instead of a 13.8 MB worker chunk (4.5 MB gzipped), the worker's own
//    chunk shrinks to about 70 KB, and WebAssembly.compileStreaming()
//    compiles the module while it is still downloading — measured in a
//    harness on a 1.6 Mbit/s link, about 5.8 s sooner to a first render
//    on a cold cache. Streaming compilation needs the response served as
//    application/wasm, which Vite's dev server and preview, GitHub Pages
//    and the desktop app all do (Electron's net.fetch(file://) takes the
//    type from Chromium's extension map; the X-Content-Type-Options:
//    nosniff main.cjs adds only forbids guessing a different one). A
//    server that types it otherwise gets the download-then-compile path:
//    slower, not broken.
//
// 2. The render worker needs a fresh INSTANCE per render
//    (src/worker/openscad-worker.js explains why), but the compiled MODULE
//    is the same every time — WebAssembly.instantiate(module, imports)
//    hands out a new instance with its own memory — so the replacement
//    wasm() memoises the compile. Measured in headless Chrome:
//    createOpenSCAD() took 40-105 ms per render before, 4-5 ms with the
//    module memoised, on renders of 400-1500 ms.
//
// A build FAILS if the loader is not found exactly as expected (one
// wasm() function holding one base64 literal), so an upstream update that
// reshapes it shows up as an error naming this file rather than as a
// silent return to the inlined copy.
//
// Listed under both `plugins` (dev server) and `worker.plugins` (the
// separate Rollup pass that bundles the worker for a build) in
// vite.config.js — a plugin in only the first list never sees the
// worker's imports at build time.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the decoded binary is kept between runs: npm's conventional place
// for derived files, inside the ignored node_modules/. Exported for the
// unit test.
export const CACHE_DIR = path.resolve(__dirname, "..", "node_modules", ".cache", "openscad-wasm");

const NEEDLE = "\nfunction wasm(imports) {\n";
// Every WebAssembly module starts with "\0asm", which is "AGFzbQ" in
// base64: where the inlined binary begins, as the loader quotes it.
const LITERAL_START = "'AGFzbQ";
// What follows the literal in the loader (the call's closing bracket,
// then the end of wasm()); anything else means the loader changed shape.
const LITERAL_TAIL = ");\n}\n";
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

// What replaces wasm(). `__openscadWasmUrl` is the hoisted `?url` import;
// the rest of openscad.js is untouched (initWasm() awaits wasm() for a
// Module and instantiates it itself), and Rollup drops the now-unused
// _loadWasmModule() from a build.
const LOADER =
  "\nlet __compiledWasm;\n" +
  "function wasm() {\n" +
  "  if (!__compiledWasm) {\n" +
  "    __compiledWasm = __compileWasm();\n" +
  "    // A failed compile is not cached, so the next render retries it.\n" +
  "    __compiledWasm.catch(() => { __compiledWasm = undefined; });\n" +
  "  }\n" +
  "  return __compiledWasm;\n" +
  "}\n" +
  "function __compileWasm() {\n" +
  "  return fetch(__openscadWasmUrl).then((res) => {\n" +
  '    if (!res.ok) throw new Error("openscad.wasm: HTTP " + res.status);\n' +
  '    const type = res.headers.get("content-type") || "";\n' +
  '    return typeof WebAssembly.compileStreaming === "function" && type.startsWith("application/wasm")\n' +
  "      ? WebAssembly.compileStreaming(res)\n" +
  "      : res.arrayBuffer().then((bytes) => WebAssembly.compile(bytes));\n" +
  "  });\n" +
  "}\n";

// The URL Vite's `?url` gives a file under the project root in dev: its
// path from the root, after the base, and no query — the same path with
// `?import&url` is Vite's request for the module that exports the URL,
// which its own middleware answers. Only a file this plugin wrote is
// answered (the name is a hash this plugin chose, under CACHE_DIR).
const DEV_URL = /\/node_modules\/\.cache\/openscad-wasm\/(openscad-[0-9a-f]{8}\.wasm)$/;

function shapeError() {
  return new Error(
    "openscad-wasm-memo: openscad-wasm's wasm() loader no longer looks as expected — " +
      "update or remove web/scripts/vite-plugin-openscad-wasm-memo.mjs",
  );
}

// Decodes the literal and keeps the binary at a content-addressed path,
// so an upstream update gets a new file and a stale one is never served.
// Returns the path.
function cacheWasm(base64) {
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC)) throw shapeError();
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  const file = path.join(CACHE_DIR, `openscad-${hash}.wasm`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // Written under a temporary name and renamed into place, so a dev
    // server and a build decoding at the same moment cannot serve each
    // other a half-written file.
    const partial = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, file);
  }
  return file;
}

export default function openscadWasmMemoPlugin() {
  return {
    name: "openscad-wasm-memo",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]openscad-wasm[\\/]openscad\.js(\?.*)?$/.test(id)) return null;
      const at = code.indexOf(NEEDLE);
      if (at === -1 || code.indexOf(NEEDLE, at + 1) !== -1) throw shapeError();
      const literalAt = code.indexOf(LITERAL_START, at);
      if (literalAt === -1 || code.indexOf(LITERAL_START, literalAt + 1) !== -1) throw shapeError();
      const literalEnd = code.indexOf("'", literalAt + 1);
      if (literalEnd === -1 || !code.startsWith(LITERAL_TAIL, literalEnd + 1)) throw shapeError();
      const file = cacheWasm(code.slice(literalAt + 1, literalEnd));
      // A static import at the top of the module: Vite resolves the
      // absolute path (forward slashes on every platform) and `?url` makes
      // it the asset's URL.
      const hoisted = `import __openscadWasmUrl from ${JSON.stringify(file.split(path.sep).join("/") + "?url")};\n`;
      const functionEnd = literalEnd + 1 + LITERAL_TAIL.length;
      return { code: hoisted + code.slice(0, at) + LOADER + code.slice(functionEnd), map: null };
    },
    // Vite answers a request for a file under the project root through
    // sirv, whose development mode refuses any path with a dot-directory
    // in it (node_modules/.cache included; Vite does not set its
    // `dotfiles` option), so the URL the `?url` import resolves to in dev
    // would be a 404. It is answered here, ahead of Vite's own
    // middlewares, typed so the browser compiles while it downloads. A
    // build is not affected: there the binary is an emitted asset.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = DEV_URL.exec(req.url ?? "");
        const file = match && path.join(CACHE_DIR, match[1]);
        if (!file || !fs.existsSync(file)) return next();
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Content-Length", fs.statSync(file).size);
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}
