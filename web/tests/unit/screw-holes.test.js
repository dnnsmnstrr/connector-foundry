import test from "node:test";
import assert from "node:assert/strict";

import {
  addHole,
  countersinkConeHeight,
  createHolesDoc,
  cutterLines,
  frameMatrix,
  holesToScad,
  normalizeSpec,
  planeBasis,
  removeHole,
  updateHole,
} from "../../src/lib/screwHoles.js";
import { SCREW_PRESETS, getPreset, specMatchesPreset } from "../../src/lib/screwPresets.js";

const partsById = new Map([
  ["basics/plate", { id: "basics/plate", name: "Flat plate", file: "parts/basics/plate.scad", module: "basics_plate" }],
]);

function plateDoc() {
  return createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40, d: 40, t: 4 } });
}

test("a document with no holes is just the base", () => {
  const scad = holesToScad(plateDoc(), partsById, { throughLength: 50 });
  assert.match(scad, /include <\.\.\/parts\/basics\/plate\.scad>/);
  assert.match(scad, /basics_plate\(w=40, d=40, t=4\);/);
  assert.doesNotMatch(scad, /difference/);
});

test("holes are subtracted inside one difference(), each in its own frame", () => {
  let { doc } = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1], spec: getPreset("m3-cap").spec, presetId: "m3-cap" });
  ({ doc } = addHole(doc, { point: [10, 0, 2], normal: [1, 0, 0], spec: getPreset("m3-insert").spec, presetId: "m3-insert" }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.equal(scad.match(/difference\(\)/g).length, 1);
  assert.equal(scad.match(/multmatrix\(/g).length, 2);
  // A through hole reaches the whole through length; a blind one its own depth.
  assert.match(scad, /translate\(\[0, 0, -50\]\) cylinder\(d = 3\.4, h = 51\)/);
  assert.match(scad, /translate\(\[0, 0, -6\.7\]\) cylinder\(d = 4, h = 7\.7\)/);
  // The counterbore pocket sits on the surface and overshoots above it.
  assert.match(scad, /translate\(\[0, 0, -3\]\) cylinder\(d = 6\.1, h = 4\)/);
});

test("a countersink is a cone from the shank out to the head diameter at the given angle", () => {
  const spec = normalizeSpec({ diameter: 3.4, depth: 0, head: "countersink", headDiameter: 6.4, headDepth: 0.5, sinkAngle: 90 });
  assert.ok(Math.abs(countersinkConeHeight(spec) - 1.5) < 1e-9);
  const lines = cutterLines({ point: [0, 0, 0], normal: [0, 0, 1], spec }, 20).join("\n");
  assert.match(lines, /translate\(\[0, 0, -2\]\) cylinder\(d1 = 3\.4, d2 = 6\.4, h = 1\.5\)/);
  assert.match(lines, /translate\(\[0, 0, -0\.5\]\) cylinder\(d = 6\.4, h = 1\.5\)/);
  const eightyTwo = normalizeSpec({ ...spec, sinkAngle: 82 });
  assert.ok(countersinkConeHeight(eightyTwo) > 1.5, "a narrower angle makes a taller cone");
});

test("a hex pocket is a six-sided cylinder", () => {
  const spec = getPreset("m3-nut").spec;
  const lines = cutterLines({ point: [0, 0, 0], normal: [0, 0, 1], spec }, 20).join("\n");
  assert.match(lines, /cylinder\(d = 6\.7, h = 3\.7, \$fn = 6\)/);
});

test("the cutter frame has +Z along the hole's normal and the surface point as origin", () => {
  const { u, v, n } = planeBasis([0, 1, 0]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.deepEqual(n, [0, 1, 0]);
  assert.ok(Math.abs(dot(u, v)) < 1e-12 && Math.abs(dot(u, n)) < 1e-12 && Math.abs(dot(v, n)) < 1e-12);
  const m = frameMatrix([1, 2, 3], [0, 1, 0]);
  // Third column is the normal, fourth the point.
  assert.match(m, /^\[\[-?[\d.]+, -?[\d.]+, 0, 1\], \[-?[\d.]+, -?[\d.]+, 1, 2\], \[-?[\d.]+, -?[\d.]+, 0, 3\], \[0, 0, 0, 1\]\]$/);
});

test("a mesh source imports its STL and hands the bytes to the caller", () => {
  const bytes = new ArrayBuffer(84);
  let { doc } = addHole(createHolesDoc({ kind: "mesh", name: "My Bracket.step", stlBytes: bytes, extents: [10, 10, 10] }), {
    point: [0, 0, 5],
    normal: [0, 0, 1],
    spec: getPreset("plain-3").spec,
  });
  const importedFiles = new Map();
  const scad = holesToScad(doc, partsById, { throughLength: 20, importedFiles });
  assert.match(scad, /import\("imports\/My-Bracket\.stl"\);/);
  assert.equal(importedFiles.get("imports/My-Bracket.stl"), bytes);
});

test("edit, remove and spec normalisation", () => {
  let { doc, hole } = addHole(plateDoc(), { point: [1, 1, 4], normal: [0, 0, 1], spec: getPreset("m4-cap").spec, presetId: "m4-cap" });
  assert.equal(doc.holes.length, 1);
  assert.ok(specMatchesPreset(hole.spec, "m4-cap"));
  doc = updateHole(doc, hole.id, { spec: { ...hole.spec, headDepth: 5 } });
  assert.equal(doc.holes[0].spec.headDepth, 5);
  assert.ok(!specMatchesPreset(doc.holes[0].spec, "m4-cap"));
  assert.equal(removeHole(doc, hole.id).holes.length, 0);
  const n = normalizeSpec({ diameter: "abc", depth: -3, head: "weird", sinkAngle: 400 });
  assert.equal(n.diameter, 3.4);
  assert.equal(n.depth, 0);
  assert.equal(n.head, "none");
  assert.equal(n.sinkAngle, 179);
});

test("every preset has a usable spec and a drawable screw", () => {
  const ids = new Set();
  for (const preset of SCREW_PRESETS) {
    assert.ok(!ids.has(preset.id), `duplicate preset id ${preset.id}`);
    ids.add(preset.id);
    assert.ok(preset.spec.diameter > 0, `${preset.id} diameter`);
    assert.ok(["none", "counterbore", "countersink", "hex"].includes(preset.spec.head), `${preset.id} head`);
    if (preset.spec.head !== "none") assert.ok(preset.spec.headDiameter > preset.spec.diameter, `${preset.id} head wider than shank`);
    assert.ok(typeof preset.screw.style === "string", `${preset.id} screw style`);
    // The spec round-trips through normalisation unchanged.
    assert.deepEqual(normalizeSpec(preset.spec), preset.spec);
  }
});
