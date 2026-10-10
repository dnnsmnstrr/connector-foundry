import test from "node:test";
import assert from "node:assert/strict";

import { parseDecimal } from "../../src/lib/decimalInput.js";

test("comma and period both read as the decimal separator", () => {
  assert.equal(parseDecimal("2.5"), 2.5);
  assert.equal(parseDecimal("2,5"), 2.5);
  assert.equal(parseDecimal("-0,75"), -0.75);
  assert.equal(parseDecimal(" 12 "), 12);
});

test("a separator still waiting for its digits keeps the whole part", () => {
  assert.equal(parseDecimal("3,"), 3);
  assert.equal(parseDecimal("3."), 3);
  assert.equal(parseDecimal(",5"), 0.5);
});

test("text that is not a number yet is null, never 0", () => {
  for (const text of ["", "-", ",", ".", "1,2,3", "1.2.3", "abc", "1e3", "Infinity"]) {
    assert.equal(parseDecimal(text), null, text);
  }
});
