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

test("an allocation failure says it was memory, in every engine's words", () => {
  for (const message of [
    "Aborted(unhandled exception: 12345,undefined). Build with -sASSERTIONS for more info.",
    "RangeError: WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance",
    "Cannot enlarge memory arrays to size 2147483648 bytes",
    "WebAssembly.Memory(): could not allocate memory",
  ]) {
    assert.match(friendlyRenderError(message), /ran out of memory/, message);
  }
  // The stack symptoms keep their own explanation, "memory" in the text or not.
  assert.match(friendlyRenderError("memory access out of bounds"), /nests too deep/);
});
