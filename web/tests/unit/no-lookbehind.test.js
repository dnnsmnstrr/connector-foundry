import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Regex lookbehind reached Safari in 16.4 (March 2023). esbuild cannot
// lower it for the build's older target and quietly turns the literal
// into `new RegExp("…")`, which the old engine then refuses with a
// SyntaxError as the chunk loads: a blank page on iOS 15 and 16, with no
// error boundary to catch it (scadLiteral.js had one until 2026-10). So
// no source the browser runs may contain one.
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(js|jsx|mjs)$/.test(entry)) yield path;
  }
}

test("no browser source uses regex lookbehind", () => {
  const offenders = [];
  for (const path of sources(SRC)) {
    const text = readFileSync(path, "utf8");
    if (/\(\?<[=!]/.test(text)) offenders.push(path.slice(SRC.length));
  }
  assert.deepEqual(offenders, []);
});
