import test from "node:test";
import assert from "node:assert/strict";

import { WASM_STACK_SYMPTOMS, friendlyRenderError } from "../../src/lib/renderError.js";

// Every wording the stack overflow was seen to take while measuring it
// (web/README.md, "Known limit — nesting depth").
const SYMPTOMS = [
  "table index is out of bounds",
  "invalid index 12 into funcref table",
  "memory access out of bounds",
  "original is not a function",
  "null function or function signature mismatch",
  "Cannot convert 32 to a BigInt",
  "Maximum call stack size exceeded",
];

test("every known stack-limit symptom becomes the explanation", () => {
  for (const message of SYMPTOMS) {
    assert.ok(WASM_STACK_SYMPTOMS.test(message), message);
    const friendly = friendlyRenderError(message);
    assert.match(friendly, /nests too deep/, message);
    assert.match(friendly, /native OpenSCAD/, message);
  }
});

test("any other failure is shown as it is", () => {
  for (const message of ["Unknown catalogue part foo/bar", "Parser error in file x.scad, line 3", ""]) {
    assert.equal(friendlyRenderError(message), message);
  }
});
