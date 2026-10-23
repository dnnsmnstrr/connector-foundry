import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import openscadWasmMemoPlugin, { CACHE_DIR } from "../../scripts/vite-plugin-openscad-wasm-memo.mjs";

const OPENSCAD_JS = createRequire(import.meta.url).resolve("openscad-wasm");
const SHAPE_ERROR = /openscad-wasm-memo: openscad-wasm's wasm\(\) loader no longer looks as expected/;

// The real module, transformed once: 14 MB of string work, so the
// assertions below share it.
const original = fs.readFileSync(OPENSCAD_JS, "utf8");
const plugin = openscadWasmMemoPlugin();
const { code } = plugin.transform(original, OPENSCAD_JS);

// How long the decoded literal is, from its base64 length alone (so the
// test need not decode 10 MB a second time).
function decodedLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

test("the inlined binary is cut out and fetched as an asset instead", () => {
  assert.equal(code.includes("AGFzbQ"), false);
  assert.match(code, /^import __openscadWasmUrl from "(.+)\?url";\n/);
  assert.match(code, /function __compileWasm\(\) \{\n {2}return fetch\(__openscadWasmUrl\)/);
  assert.match(code, /WebAssembly\.compileStreaming\(res\)/);
  assert.match(code, /res\.arrayBuffer\(\)\.then\(\(bytes\) => WebAssembly\.compile\(bytes\)\)/);
  // The memoising wasm() in front of it, with its retry.
  assert.match(code, /\nlet __compiledWasm;\nfunction wasm\(\) \{\n/);
  assert.match(code, /__compiledWasm\.catch\(\(\) => \{ __compiledWasm = undefined; \}\);/);
});

test("the rest of openscad.js is untouched", () => {
  const needle = "\nfunction wasm(imports) {\n";
  const before = original.slice(0, original.indexOf(needle));
  const after = original.slice(original.indexOf("\n}\n", original.indexOf("'AGFzbQ")) + 3);
  assert.ok(after.startsWith("var OpenSCAD = "));
  assert.equal(code.slice(code.indexOf("\n") + 1, code.indexOf("\n") + 1 + before.length), before);
  assert.ok(code.endsWith(after));
});

test("the cache file holds the decoded binary, named by its hash", () => {
  const [, imported] = /^import __openscadWasmUrl from "(.+)\?url";\n/.exec(code);
  const file = path.resolve(imported);
  assert.equal(path.dirname(file), CACHE_DIR);
  assert.match(path.basename(file), /^openscad-[0-9a-f]{8}\.wasm$/);
  const literalAt = original.indexOf("'AGFzbQ") + 1;
  const base64 = original.slice(literalAt, original.indexOf("'", literalAt));
  const stat = fs.statSync(file);
  assert.equal(stat.size, decodedLength(base64));
  const magic = Buffer.alloc(4);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, magic, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  assert.deepEqual([...magic], [0x00, 0x61, 0x73, 0x6d]);
});

test("a loader of another shape fails the build, naming this plugin", () => {
  assert.throws(
    () => plugin.transform("function wasm(imports) {\n  return other();\n}\n", OPENSCAD_JS),
    SHAPE_ERROR,
  );
  const needle = "\nfunction wasm(imports) {\n";
  assert.throws(() => plugin.transform(`${needle}  return 1;\n}\n`, OPENSCAD_JS), SHAPE_ERROR);
  assert.throws(() => plugin.transform(`${needle}${needle}`, OPENSCAD_JS), SHAPE_ERROR);
  // Only openscad-wasm's own module is touched.
  assert.equal(plugin.transform("function wasm(imports) {}", "/elsewhere/openscad.js"), null);
});

test("the dev server answers the cache file's URL as application/wasm", async () => {
  const [, imported] = /^import __openscadWasmUrl from "(.+)\?url";\n/.exec(code);
  const name = path.basename(imported);
  let handler;
  plugin.configureServer({ middlewares: { use: (fn) => (handler = fn) } });
  const serve = (url) =>
    new Promise((resolve) => {
      const headers = {};
      const chunks = [];
      const res = {
        setHeader: (key, value) => (headers[key] = value),
        write: (chunk) => chunks.push(chunk),
        end: () => resolve({ headers, body: Buffer.concat(chunks), passed: false }),
        on: () => res,
        once: () => res,
        emit: () => false,
        // What a stream pipes into: the three members above and these.
        writable: true,
        removeListener: () => res,
      };
      handler({ url }, res, () => resolve({ passed: true }));
    });
  const served = await serve(`/node_modules/.cache/openscad-wasm/${name}`);
  assert.equal(served.passed, false);
  assert.equal(served.headers["Content-Type"], "application/wasm");
  assert.equal(served.body.length, served.headers["Content-Length"]);
  assert.deepEqual([...served.body.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
  // Anything else — the module that exports the URL, a name this plugin
  // did not write, another path — is left to Vite.
  assert.equal((await serve(`/node_modules/.cache/openscad-wasm/${name}?import&url`)).passed, true);
  assert.equal((await serve("/node_modules/.cache/openscad-wasm/openscad-00000000.wasm")).passed, true);
  assert.equal((await serve(`/app/${name}`)).passed, true);
});
