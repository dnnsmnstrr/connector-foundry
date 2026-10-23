import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT, ROOT_DIRS, stripForBundle } from "../../scripts/sync-scad.mjs";

const lineCount = (text) => text.split("\n").length;

// A vendored file, or null in a checkout without the submodules (CI has
// them; a fresh worktree does not — see AGENTS.md "Setup").
function vendored(...segments) {
  const file = path.join(REPO_ROOT, "vendor", ...segments);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function scadFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scadFiles(full, out);
    else if (entry.name.endsWith(".scad")) out.push(full);
  }
  return out;
}

test("comments go, code and string literals stay, line for line", () => {
  const source = [
    "// Header line one",
    "// Header line two   ",
    "",
    "// Not the header: include <old.scad>",
    'url = "http://example.com/a"; // trailing comment   ',
    'glob = "/* not a comment */";',
    'quoted = "a \\"//\\" b";',
    "/* block /* with // inside",
    '   and a " quote, spanning lines */ x = 1;   ',
    "y = 2 /* inline */ + 3; // it's a tail",
    "z = x / y;",
  ].join("\n");
  const expected = [
    "// Header line one",
    "// Header line two",
    "",
    "",
    'url = "http://example.com/a";',
    'glob = "/* not a comment */";',
    'quoted = "a \\"//\\" b";',
    "",
    " x = 1;",
    "y = 2  + 3;",
    "z = x / y;",
  ].join("\n");
  assert.equal(stripForBundle(source), expected);
});

test("a file's leading comment block is kept, the comments after its first blank line are not", () => {
  const licence = "/*\n * Copyright (c) 2021 Someone\n * BSD-2-Clause\n */";
  assert.equal(
    stripForBundle(`${licence}\n\n// A module's doc\nmodule m() {} // tail\n`),
    `${licence}\n\n\nmodule m() {}\n`,
  );
  // Leading blank lines do not end a block that has not begun.
  assert.equal(
    stripForBundle("\n\n// Notice\n// line two\nx = 1;\n"),
    "\n\n// Notice\n// line two\nx = 1;\n",
  );
  // A file that starts with code has no block to keep.
  assert.equal(stripForBundle("x = 1; // one\n// two\ny = 2;\n"), "x = 1;\n\ny = 2;\n");
  // A customizer group marker followed by code on its line.
  assert.equal(stripForBundle("/* [Shape] */ a = 1; // mm\nb = 2;"), "/* [Shape] */ a = 1;\nb = 2;");
});

test("an unterminated string or block comment runs to the end without throwing", () => {
  assert.equal(stripForBundle('x = "open\ny = 1;'), 'x = "open\ny = 1;');
  assert.equal(stripForBundle("x = 1; /* open\ny = 1;"), "x = 1;\n");
});

test("the BOSL2 files whose comments quote comment markers strip cleanly", (t) => {
  const constants = vendored("BOSL2", "constants.scad");
  const strings = vendored("BOSL2", "strings.scad");
  if (!constants || !strings) return t.skip("vendor/BOSL2 is not checked out");
  // A naive regex strip reads these as string literals; they are comments.
  assert.match(constants, /\(add "\/\/" to the beginning\)/);
  assert.match(strings, /"; {2}\/\/ parsed as "/);
  const strippedConstants = stripForBundle(constants);
  const strippedStrings = stripForBundle(strings);
  assert.doesNotMatch(strippedConstants, /add "\/\/" to the beginning/);
  assert.doesNotMatch(strippedStrings, /parsed as "/);
  // The literals in code survive, the LibFile header too.
  assert.match(strippedConstants, /^_UNDEF="LRG\+HX7dy89RyHvDlAKvb9Y04OTuaikpx205CTh8BSI";$/m);
  assert.match(strippedConstants, /echo\("Warning: constants\.scad included without std\.scad;/);
  assert.match(strippedStrings, /assert\(pos>=0,"\\npos value for substr\(\) must be nonnegative\."\)/);
  assert.match(strippedConstants, /^\/\/ LibFile: constants\.scad$/m);
  assert.equal(lineCount(strippedConstants), lineCount(constants));
  assert.equal(lineCount(strippedStrings), lineCount(strings));
});

test("an upstream's copyright notice travels with its source", (t) => {
  const gopro = vendored("GoProScad", "GoPro.scad");
  if (!gopro) return t.skip("vendor/GoProScad is not checked out");
  const stripped = stripForBundle(gopro);
  assert.match(stripped, /^ \* Copyright \(c\) Michal A\. Valasek, 2021 +\*$/m);
  assert.ok(stripped.length < gopro.length);
});

test("every source keeps its line count when stripped", () => {
  const files = [...ROOT_DIRS, "vendor"].flatMap((dir) => scadFiles(path.join(REPO_ROOT, dir)));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(lineCount(stripForBundle(source)), lineCount(source), path.relative(REPO_ROOT, file));
  }
});
