import test from "node:test";
import assert from "node:assert/strict";

import { atLimit, parseDecimal, stepDecimal, stepSize } from "../../src/lib/decimalInput.js";

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

test("a step is rounded and held to min and max", () => {
  assert.equal(stepDecimal(1, 0.1, undefined, undefined), 1.1);
  assert.equal(stepDecimal(0.3, -0.1, "0", undefined), 0.2);
  assert.equal(stepDecimal(0.05, -0.1, "0", undefined), 0);
  assert.equal(stepDecimal(359.5, 1, "-360", "360"), 360);
  assert.equal(stepDecimal(2, -1, "", ""), 1);
});

test("Shift makes the keyboard coarser and the pointer finer", () => {
  assert.equal(stepSize(1, "key", false), 1);
  assert.equal(stepSize(1, "key", true), 10);
  assert.equal(stepSize(1, "button", true), 0.5);
  assert.equal(stepSize(1, "wheel", true), 0.1);
  assert.equal(stepSize("15", "wheel", false), 15);
  assert.equal(stepSize("15", "button", true), 7.5);
});

test("an arrow is at its limit only at (or past) the bound it steps towards", () => {
  assert.equal(atLimit(20, 1, 14, 20), true);
  assert.equal(atLimit(20, -1, 14, 20), false);
  assert.equal(atLimit(14, -1, "14", "20"), true);
  assert.equal(atLimit(19.5, 1, 14, 20), false);
  assert.equal(atLimit(25, 1, undefined, 20), true);
  assert.equal(atLimit(5, -1, undefined, 20), false);
  assert.equal(atLimit("", 1, 0, 1), false);
});
