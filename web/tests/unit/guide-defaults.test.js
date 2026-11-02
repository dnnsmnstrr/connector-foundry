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
    insetFor: null,
  });
  // The face that matters is the broadest, whichever way the part lies,
  // and its narrower side limits both: 100 x 30 on its side is 30 across.
  assert.deepEqual(guideDefaults(null, [30, 4, 100]), { inset: 5, radius: 9, insetFor: null });
  // Too small to leave the margin: no circle, and corners a quarter in.
  assert.deepEqual(guideDefaults(null, [10, 10, 4]), { inset: 2.5, radius: 0, insetFor: null });
  assert.deepEqual(guideDefaults(null, [16, 16, 4]), { inset: 4, radius: 2, insetFor: null });
  // In half millimetres, as the fields step.
  assert.deepEqual(guideDefaults(null, [41.5, 41.5, 7]), { inset: 5, radius: 15, insetFor: null });
  // Nothing to go by yet (the model hasn't rendered): the old defaults.
  assert.deepEqual(guideDefaults(null, null), {
    inset: DEFAULT_CORNER_INSET_MM,
    radius: DEFAULT_CENTER_RADIUS_MM,
    insetFor: null,
  });
});

test("Gridfinity's inset is each face's own, so the corner points land on its magnet holes", () => {
  // The holes sit 8 mm in from each 42 mm cell's edge, 13 mm from its middle.
  const { insetFor, inset, radius } = guideDefaults(part("gridfinity/bin"), [83.5, 41.5, 21]);
  assert.ok(insetFor);
  // A bin's top: each cell 41.5 across (0.5 short of the grid), 7.75 in.
  assert.equal(insetFor([41.5, 41.5]), 7.75);
  assert.equal(insetFor([83.5, 41.5]), 7.75);
  // A foot's bottom: 41.5 less the profile's 2.95 each side, 35.6 across,
  // 4.8 in (gridfinity-rebuilt's HOLE_DISTANCE_FROM_BOTTOM_EDGE).
  assert.equal(insetFor([35.6, 35.6]), 4.8);
  // A baseplate's underside is the grid itself: 8 in.
  assert.equal(guideDefaults(part("gridfinity/baseplate"), [84, 84, 5]).insetFor?.([84, 84]), 8);
  // A bin's side has no holes to land on: the size rule, a quarter in at most 5.
  assert.equal(insetFor([41.5, 21]), 5);
  // Before a face is picked, the bar shows the broadest face's; the circle
  // is 14.5, through the quadrant centers of a cell's top.
  assert.equal(inset, 7.75);
  assert.equal(radius, 14.5);
  // A grid tuned in Settings moves the holes with it, still 8 mm in from
  // each cell's edge: on a 40 mm grid a bin's top is 39.5 across.
  const tuned = guideDefaults(part("gridfinity/bin"), [39.5, 39.5, 21], { GRIDFINITY_PITCH: 40 });
  assert.equal(tuned.insetFor?.([39.5, 39.5]), 7.75);
  assert.equal(tuned.insetFor?.([79.5, 39.5]), 7.75);
  // A plain part has no per-face rule.
  assert.equal(guideDefaults(part("basics/plate"), [42, 42, 4]).insetFor, null);
});

test("a round part's circle goes half way out; MultiConnect's to half its 20 mm head", () => {
  assert.equal(guideDefaults(part("magsafe/mount"), [56, 56, 3]).radius, 14);
  assert.equal(guideDefaults(part("basics/post"), [20, 20, 30]).radius, 5);
  assert.equal(guideDefaults(part("opengrid/multiconnect"), [25.58, 25.58, 10]).radius, 5);
});

test("openGrid snaps and SOLDR bases: no corner points, the circle through the quadrant centers", () => {
  // A snap's body is 24.8 mm across: quadrant centers 6.2 mm out each
  // way, 8.77 mm from the middle. A 1 x 1 SOLDR base is 28.8: 10.18 mm.
  for (const id of ["opengrid/snap", "opengrid/openconnect"]) {
    assert.deepEqual(guideDefaults(part(id), [25.58, 25.58, 6.8]), {
      inset: 0,
      radius: 8.75,
      insetFor: null,
    });
  }
  assert.ok(Math.abs(Math.hypot(24.8 / 4, 24.8 / 4) - 8.75) < 0.05);
  assert.deepEqual(guideDefaults(part("soldr/base"), [28.8, 28.8, 3]), {
    inset: 0,
    radius: 10.2,
    insetFor: null,
  });
  assert.ok(Math.abs(Math.hypot(28.8 / 4, 28.8 / 4) - 10.2) < 0.05);
});

test("a malformed holes_guides falls back to the size rule", () => {
  const bad = { holes_guides: { inset: -1, radius: "x", round: "yes" } };
  assert.deepEqual(guideDefaults(bad, [42, 42, 4]), { inset: 5, radius: 15, insetFor: null });
});
