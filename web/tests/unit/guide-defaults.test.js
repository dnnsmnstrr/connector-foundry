import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";

import { GUIDE_MARGIN_MM, guideDefaults } from "../../src/lib/guideDefaults.js";
import { DEFAULT_CENTER_RADIUS_MM, DEFAULT_CORNER_INSET_MM } from "../../src/lib/snapCandidates.js";

const catalogue = /** @type {any} */ (
  yaml.load(fs.readFileSync(new URL("../../../catalogue.yaml", import.meta.url), "utf8"))
);
const part = (/** @type {string} */ id) => catalogue.parts.find((/** @type {any} */ p) => p.id === id);

test("a plain part: the circle stays the margin inside its broadest face, the inset at most 5 mm", () => {
  // A 42 x 42 x 4 plate: 21 - 6 = 15.
  assert.deepEqual(guideDefaults(part("basics/plate"), [42, 42, 4]), {
    inset: 5,
    radius: 21 - GUIDE_MARGIN_MM,
  });
  // The face that matters is the broadest, whichever way the part lies,
  // and its narrower side limits both: 100 x 30 on its side is 30 across.
  assert.deepEqual(guideDefaults(null, [30, 4, 100]), { inset: 5, radius: 9 });
  // Too small to leave the margin: no circle, and corners a quarter in.
  assert.deepEqual(guideDefaults(null, [10, 10, 4]), { inset: 2.5, radius: 0 });
  assert.deepEqual(guideDefaults(null, [16, 16, 4]), { inset: 4, radius: 2 });
  // In half millimetres, as the fields step.
  assert.deepEqual(guideDefaults(null, [41.5, 41.5, 7]), { inset: 5, radius: 15 });
  // Nothing to go by yet (the model hasn't rendered): the old defaults.
  assert.deepEqual(guideDefaults(null, null), {
    inset: DEFAULT_CORNER_INSET_MM,
    radius: DEFAULT_CENTER_RADIUS_MM,
  });
});

test("Gridfinity's inset lands the corner points on its magnet holes", () => {
  // gridfinity-rebuilt's HOLE_DISTANCE_FROM_BOTTOM_EDGE, on a foot's bottom.
  assert.equal(guideDefaults(part("gridfinity/bin"), [83.5, 41.5, 21]).inset, 4.8);
  assert.equal(guideDefaults(part("gridfinity/base"), [41.5, 41.5, 5]).inset, 4.8);
  // A baseplate's outline is the 42 mm grid: 8 mm in from a cell's edge.
  assert.equal(guideDefaults(part("gridfinity/baseplate"), [84, 84, 5]).inset, 8);
  // Its radius still comes from its size.
  assert.equal(guideDefaults(part("gridfinity/bin"), [83.5, 41.5, 21]).radius, 15);
});

test("a round part's circle goes half way out; MultiConnect's to half its 20 mm head", () => {
  assert.equal(guideDefaults(part("magsafe/mount"), [56, 56, 3]).radius, 14);
  assert.equal(guideDefaults(part("basics/post"), [20, 20, 30]).radius, 5);
  assert.equal(guideDefaults(part("opengrid/multiconnect"), [25.58, 25.58, 10]).radius, 5);
});

test("a malformed holes_guides falls back to the size rule", () => {
  const bad = { holes_guides: { inset: -1, radius: "x", round: "yes" } };
  assert.deepEqual(guideDefaults(bad, [42, 42, 4]), { inset: 5, radius: 15 });
});
