import test from "node:test";
import assert from "node:assert/strict";

import { compatProblems } from "../../scripts/check-dist-compat.mjs";

// The build-output check (scripts/check-dist-compat.mjs, run after every
// build): what an engine at the app's floor could not parse is reported,
// lowered or not.

test("a lookbehind is found as a literal and as esbuild's lowered RegExp string", () => {
  assert.equal(compatProblems("const a = /(?<!x)y/g;", "module").length, 1);
  assert.equal(compatProblems('const a = new RegExp("(?<=x)y", "g");', "module").length, 1);
});

test("syntax past ECMAScript 2022 fails; what the build target emits passes", () => {
  assert.match(compatProblems("const a = /[\\p{L}--[a-z]]/v;", "module").join(), /not ECMAScript 2022/);
  assert.deepEqual(
    compatProblems("export const a = b?.c ?? import.meta.url; class C { x = 1; #y = 2 }", "module"),
    [],
  );
  // The classic scripts at the root parse as scripts.
  assert.deepEqual(compatProblems("(function () { var a = 1; })();", "script"), []);
});
