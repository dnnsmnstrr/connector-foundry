import assert from "node:assert/strict";
import { test } from "node:test";
import { outsideDimensions } from "../../src/lib/outsideDimensions.js";

test("formats STL extents as width, height, and depth", () => {
  assert.deepEqual(outsideDimensions([40, 30, 10]), {
    width: "40",
    height: "10",
    depth: "30",
  });
});

test("rounds floating-point tails without losing useful precision", () => {
  assert.deepEqual(outsideDimensions([39.9999999997, 1.23456, 0.125]), {
    width: "40",
    height: "0.125",
    depth: "1.235",
  });
});
