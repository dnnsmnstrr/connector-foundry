import test from "node:test";
import assert from "node:assert/strict";

import {
  addHole,
  countersinkConeHeight,
  createHolesDoc,
  cutterLines,
  flipHoles,
  frameMatrix,
  holeFootprintRadius,
  holeLabel,
  holesToScad,
  normalizeSpec,
  planeBasis,
  removeHole,
  slotFrame,
  slotOutline,
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

test("a connector slot brings BOSL2 in itself, so it works on a mesh source", () => {
  // Both slots need std.scad included at top level (BOSL2's tag
  // variables; mc_slot()'s cylinders are BOSL2's too), and a mesh
  // source has no part include to bring it in.
  const { doc } = addHole(createHolesDoc({ kind: "mesh", name: "bench", stlBytes: new ArrayBuffer(84), extents: [40, 40, 10] }), {
    point: [0, -20, 5],
    normal: [0, -1, 0],
    spec: { ...getPreset("oc-slot").spec, spin: 90 },
  });
  const scad = holesToScad(doc, partsById, { throughLength: 60, importedFiles: new Map() });
  assert.match(scad, /^include <\.\.\/vendor\/BOSL2\/std\.scad>\nuse <\.\.\/lib\/openconnect\.scad>$/m);
  // A MultiConnect slot alone needs it just the same, once.
  let mc = addHole(createHolesDoc({ kind: "mesh", name: "bench", stlBytes: new ArrayBuffer(84), extents: [40, 40, 10] }), {
    point: [0, 0, 10],
    normal: [0, 0, 1],
    spec: getPreset("mc-slot").spec,
  }).doc;
  assert.match(holesToScad(mc, partsById, { throughLength: 60, importedFiles: new Map() }), /^include <\.\.\/vendor\/BOSL2\/std\.scad>\nuse <\.\.\/lib\/multiconnect\.scad>$/m);
  mc = addHole(mc, { point: [10, 10, 10], normal: [0, 0, 1], spec: getPreset("oc-slot").spec }).doc;
  assert.equal(holesToScad(mc, partsById, { throughLength: 60, importedFiles: new Map() }).match(/BOSL2\/std\.scad/g).length, 1);
  // Screw holes are builtins only and need nothing more.
  const screw = addHole(createHolesDoc({ kind: "mesh", name: "bench", stlBytes: new ArrayBuffer(84), extents: [40, 40, 10] }), {
    point: [0, 0, 10],
    normal: [0, 0, 1],
    spec: getPreset("m3-cap").spec,
  }).doc;
  assert.doesNotMatch(holesToScad(screw, partsById, { throughLength: 60, importedFiles: new Map() }), /BOSL2/);
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
    if (preset.spec.kind === "screw") {
      assert.ok(preset.spec.diameter > 0, `${preset.id} diameter`);
      assert.ok(["none", "counterbore", "countersink", "hex"].includes(preset.spec.head), `${preset.id} head`);
      if (preset.spec.head !== "none") assert.ok(preset.spec.headDiameter > preset.spec.diameter, `${preset.id} head wider than shank`);
    } else {
      assert.ok(["openconnect", "multiconnect"].includes(preset.spec.kind), `${preset.id} kind`);
      assert.equal(preset.spec.spin, 0, `${preset.id} starts unturned`);
    }
    assert.ok(typeof preset.screw.style === "string", `${preset.id} screw style`);
    // The spec round-trips through normalisation unchanged.
    assert.deepEqual(normalizeSpec(preset.spec), preset.spec);
  }
});

test("a connector slot is cut by the repo's own library in a frame whose +Y is the face's up", () => {
  let { doc } = addHole(plateDoc(), { point: [5, -3, 4], normal: [0, 0, 1], spec: getPreset("oc-slot").spec, presetId: "oc-slot" });
  ({ doc } = addHole(doc, { point: [0, 0, 0], normal: [0, 0, -1], spec: getPreset("mc-slot-open").spec, presetId: "mc-slot-open" }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.match(scad, /^use <\.\.\/lib\/openconnect\.scad>$/m);
  assert.match(scad, /^use <\.\.\/lib\/multiconnect\.scad>$/m);
  assert.match(scad, /oc_slot\(lock = "left", side_clearance = 0\.1, depth_clearance = 0\.1, overshoot = 1\);/);
  assert.match(scad, /mc_slot\(length = 25, on_ramp = false, detent = true, clearance = 0, overshoot = 1\);/);
  // On the top face of a plate lying flat, the slot's +Y is the part's +Y
  // and its +X the part's +X: an identity frame at the point.
  assert.match(scad, /multmatrix\(\[\[1, 0, 0, 5\], \[0, 1, 0, -3\], \[0, 0, 1, 4\], \[0, 0, 0, 1\]\]\)/);
  // On the bottom face it still runs along +Y, seen from below (so X
  // flips to keep the frame right-handed).
  assert.match(scad, /multmatrix\(\[\[-1, 0, 0, 0\], \[0, 1, 0, 0\], \[0, 0, -1, 0\], \[0, 0, 0, 1\]\]\)/);
  // A screw preset has no use lines to carry.
  assert.doesNotMatch(holesToScad(plateDoc(), partsById, { throughLength: 50 }), /use </);
});

test("a slot's frame: straight up on a vertical face, the part's Y on a level one, and spin turns it counter-clockwise", () => {
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  // Every vertical face, whichever way it faces, points the slot up.
  for (const normal of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [Math.SQRT1_2, Math.SQRT1_2, 0]]) {
    const f = slotFrame([0, 0, 0], normal, 0);
    assert.ok(close(f.ey, [0, 0, 1]), `vertical face ${normal}: ${JSON.stringify(f)}`);
  }
  // Seen from the front (-Y), +X completes the right-handed frame.
  let f = slotFrame([0, 0, 0], [0, -1, 0], 0);
  assert.ok(close(f.ex, [1, 0, 0]), `front face ${JSON.stringify(f)}`);
  // A face tilted back 20° from vertical still points up its slope.
  const t = (20 * Math.PI) / 180;
  f = slotFrame([0, 0, 0], [Math.cos(t), 0, Math.sin(t)], 0);
  assert.ok(f.ey[2] > 0.9 && Math.abs(f.ey[1]) < 1e-9, `tilted face ${JSON.stringify(f)}`);
  // Level faces (top and bottom) run along the part's Y.
  assert.ok(close(slotFrame([0, 0, 0], [0, 0, 1], 0).ey, [0, 1, 0]));
  assert.ok(close(slotFrame([0, 0, 0], [0, 0, -1], 0).ey, [0, 1, 0]));
  // A quarter turn on the top face sends the slot's +Y to the part's -X.
  f = slotFrame([0, 0, 0], [0, 0, 1], 90);
  assert.ok(close(f.ey, [-1, 0, 0]) && close(f.ex, [0, 1, 0]), `turned ${JSON.stringify(f)}`);
  // Spin is kept in [0, 360).
  assert.equal(normalizeSpec({ kind: "openconnect", spin: -90 }).spin, 270);
  assert.equal(normalizeSpec({ kind: "multiconnect", spin: 720 }).spin, 0);
  assert.equal(normalizeSpec({ kind: "openconnect", lock: "sideways" }).lock, "left");
  assert.equal(normalizeSpec({ kind: "multiconnect", length: -4 }).length, 25);
});

test("a slot keeps pointing the same way along a flipped mesh", () => {
  let { doc } = addHole(createHolesDoc({ kind: "mesh", name: "lid", stlBytes: new ArrayBuffer(84), extents: [40, 40, 4] }), {
    point: [0, 0, 4],
    normal: [0, 0, 1],
    spec: getPreset("oc-slot").spec,
  });
  const before = slotFrame(doc.holes[0].point, doc.holes[0].normal, doc.holes[0].spec.spin);
  const flipped = flipHoles(doc, 4);
  assert.equal(flipped.holes[0].spec.spin, 180);
  const after = slotFrame(flipped.holes[0].point, flipped.holes[0].normal, flipped.holes[0].spec.spin);
  // The half turn about X sends the part's +Y to the world's -Y; the
  // slot's +Y follows it.
  assert.ok(after.ey.every((v, i) => Math.abs(v + before.ey[i]) < 1e-9), JSON.stringify({ before, after }));
  assert.equal(flipHoles(flipped, 4).holes[0].spec.spin, 0);
});

test("a slot's outline and footprint are drawn around its point, in its frame", () => {
  const hole = { point: [10, 0, 4], normal: [0, 0, 1], spec: normalizeSpec({ kind: "multiconnect", length: 20, onRamp: true, detent: true, spin: 0 }) };
  const segments = slotOutline(hole);
  assert.ok(segments.length > 40, "round end, channel, entry circle and arrow");
  // Every point lies on the face (z = 4); the channel runs toward -Y
  // from the point and the entry circle sits at its far end.
  assert.ok(segments.every((s) => Math.abs(s.a[2] - 4) < 1e-9 && Math.abs(s.b[2] - 4) < 1e-9));
  const ys = segments.flatMap((s) => [s.a[1], s.b[1]]);
  assert.ok(Math.min(...ys) < -20 - 11 && Math.max(...ys) > 10, `extent ${Math.min(...ys)}..${Math.max(...ys)}`);
  assert.ok(segments.some((s) => s.dashed), "the entry is dashed");
  assert.equal(slotOutline({ ...hole, spec: getPreset("m3-cap").spec }).length, 0);
  assert.ok(holeFootprintRadius(hole.spec) > 10 && holeFootprintRadius(getPreset("m3-cap").spec) < 4);
  assert.equal(holeLabel(hole), "MultiConnect slot 20 long");
  assert.equal(holeLabel({ ...hole, spec: normalizeSpec({ kind: "openconnect", lock: "none", spin: 90 }) }), "openConnect slot, no lock, 90°");
});

test("flipping the mesh carries its holes to the same spots on the turned-over part", () => {
  let { doc } = addHole(createHolesDoc({ kind: "mesh", name: "lid", stlBytes: new ArrayBuffer(84), extents: [10, 20, 4] }), {
    point: [3, 5, 4],
    normal: [0, 0, 1],
    spec: getPreset("m3-cap").spec,
  });
  ({ doc } = addHole(doc, { point: [5, 2, 1], normal: [1, 0, 0], spec: getPreset("m3-cap").spec }));
  const flipped = flipHoles(doc, 4);
  // The top-face hole is now on the bottom face, pointing down; the
  // side hole keeps its x and still points out of the same side.
  assert.deepEqual(flipped.holes[0].point, [3, -5, 0]);
  assert.deepEqual(flipped.holes[0].normal, [0, -0, -1]);
  assert.deepEqual(flipped.holes[1].point, [5, -2, 3]);
  assert.deepEqual(flipped.holes[1].normal, [1, -0, -0]);
  // Flipping back restores the originals.
  assert.deepEqual(flipHoles(flipped, 4).holes.map((h) => h.point), doc.holes.map((h) => h.point));
});
