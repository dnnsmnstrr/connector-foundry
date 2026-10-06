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
  holeMeta,
  holesToScad,
  normalizeSpec,
  planeBasis,
  removeHole,
  rotateHoles,
  slotFrame,
  slotOutline,
  updateHole,
} from "../../src/lib/screwHoles.js";
import { SCREW_PRESETS, getPreset, presetSpecFor, specMatchesPreset } from "../../src/lib/screwPresets.js";

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
      assert.ok(["openconnect", "multiconnect", "thread"].includes(preset.spec.kind), `${preset.id} kind`);
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
  assert.match(scad, /mc_slot\(length = 28, on_ramp = false, detent = true, clearance = 0, overshoot = 1\);/);
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
  assert.equal(normalizeSpec({ kind: "multiconnect", length: -4 }).length, 28);
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

test("several holes: shared fields, patched together, turned each from its own direction, removed at once", async () => {
  const { patchHoles, removeHoles, rotateHoles, setHolesSpec, sharedSpec } = await import("../../src/lib/screwHoles.js");
  let doc = plateDoc();
  const add = (spec, presetId) => {
    const r = addHole(doc, { point: [doc.holes.length * 10, 0, 4], normal: [0, 0, 1], spec, presetId });
    doc = r.doc;
    return r.hole.id;
  };
  const a = add(getPreset("m3-cap").spec, "m3-cap");
  const b = add({ ...getPreset("m3-cap").spec, headDepth: 5 }, "m3-cap");
  const c = add({ ...getPreset("oc-slot").spec, spin: 90 }, "oc-slot");
  const d = add(getPreset("oc-slot").spec, "oc-slot");

  // Two screw holes: everything but the edited head depth is shared.
  let shared = sharedSpec(doc.holes.filter((h) => [a, b].includes(h.id)));
  assert.equal(shared.kind, "screw");
  assert.deepEqual([...shared.mixed], ["headDepth"]);
  assert.equal(shared.spec.diameter, 3.4);
  assert.equal(shared.presetId, "m3-cap");
  // A screw hole and a slot share nothing.
  assert.equal(sharedSpec(doc.holes.filter((h) => [a, c].includes(h.id))).kind, null);

  // A patch sets one field on all of them and leaves the rest alone.
  doc = patchHoles(doc, [a, b], { diameter: 4.5 });
  assert.deepEqual(doc.holes.slice(0, 2).map((h) => [h.spec.diameter, h.spec.headDepth]), [[4.5, 3], [4.5, 5]]);

  // Turning two slots keeps their difference; a screw hole in the
  // selection has no direction and is left alone.
  doc = rotateHoles(doc, [a, c, d], -90);
  assert.deepEqual(doc.holes.slice(2).map((h) => h.spec.spin), [0, 270]);
  assert.equal(doc.holes[0].spec.diameter, 4.5);

  // A preset over several: each keeps its place, and a slot staying a
  // slot keeps the way it points.
  doc = setHolesSpec(doc, [c, d], getPreset("oc-slot-both").spec, "oc-slot-both");
  assert.deepEqual(doc.holes.slice(2).map((h) => [h.spec.lock, h.spec.spin, h.presetId]), [["both", 0, "oc-slot-both"], ["both", 270, "oc-slot-both"]]);
  doc = setHolesSpec(doc, [b, c], getPreset("m4-csk").spec, "m4-csk");
  assert.deepEqual(doc.holes.slice(1, 3).map((h) => [h.spec.kind, h.spec.head, h.point[0]]), [["screw", "countersink", 10], ["screw", "countersink", 20]]);

  assert.deepEqual(removeHoles(doc, [a, d]).holes.map((h) => h.id), [b, c]);
});

test("switching slot presets keeps what the hole shares with the new one", async () => {
  const { presetSpecFor } = await import("../../src/lib/screwPresets.js");
  // A MultiConnect slot with its channel, gap and direction set...
  const tuned = { ...getPreset("mc-slot").spec, length: 40, clearance: 0.2, spin: 90 };
  // ...switched to open-ended: those stay, the preset's own fields change.
  const open = presetSpecFor(tuned, getPreset("mc-slot-open").spec);
  assert.deepEqual(open, { kind: "multiconnect", length: 40, onRamp: false, detent: true, rampEvery: false, clearance: 0.2, spin: 90 });
  // Still that preset, not "(edited)": length and direction are placement.
  assert.ok(specMatchesPreset(open, "mc-slot-open"));
  assert.ok(!specMatchesPreset({ ...open, detent: false }, "mc-slot-open"));
  // openConnect: the lock is the preset's, the gaps and direction carry.
  const oc = presetSpecFor({ ...getPreset("oc-slot").spec, sideClearance: 0.2, spin: 180 }, getPreset("oc-slot-both").spec);
  assert.deepEqual([oc.lock, oc.sideClearance, oc.depthClearance, oc.spin], ["both", 0.2, 0.1, 180]);
  // Across slot kinds only the direction is shared.
  const mc = presetSpecFor(oc, getPreset("mc-slot").spec);
  assert.deepEqual(mc, { ...getPreset("mc-slot").spec, spin: 180 });
  // A screw preset is a whole fastener: nothing carries, either way.
  assert.deepEqual(presetSpecFor(tuned, getPreset("m3-cap").spec), getPreset("m3-cap").spec);
  assert.deepEqual(presetSpecFor(getPreset("m3-cap").spec, getPreset("mc-slot").spec), getPreset("mc-slot").spec);
  // A screw preset's match still compares every field.
  assert.ok(!specMatchesPreset({ ...getPreset("m3-cap").spec, depth: 8 }, "m3-cap"));
});

test("a MultiConnect slot can have an on-ramp every openGrid cell, for a column of heads", async () => {
  const { RAMP_SPACING_MM } = await import("../../src/lib/screwHoles.js");
  const spec = normalizeSpec({ ...getPreset("mc-slot").spec, length: 84, rampEvery: true });
  const { doc } = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1], spec });
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.match(scad, /mc_slot\(length = 84, on_ramp = true, detent = true, clearance = 0, overshoot = 1, ramp_spacing = 28\);/);
  // Off, or with no on-ramp at all, there is no spacing to cut.
  for (const off of [{ rampEvery: false }, { onRamp: false }]) {
    const plain = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1], spec: { ...spec, ...off } }).doc;
    assert.doesNotMatch(holesToScad(plain, partsById, { throughLength: 50 }), /ramp_spacing/);
  }
  // The outline draws a ramp circle at 28, 56 and the end (84): three
  // dashed loops of 37 segments each.
  const dashed = slotOutline({ point: [0, 0, 4], normal: [0, 0, 1], spec }).filter((seg) => seg.dashed);
  assert.equal(dashed.length, 3 * 37);
  const ys = [...new Set(dashed.map((seg) => Math.round((seg.a[1] + seg.b[1]) / 2 / 14) * 14))];
  assert.ok(ys.includes(-28) && ys.includes(-56) && ys.includes(-84), `ramp centres near ${ys}`);
  assert.equal(RAMP_SPACING_MM, 28);
  assert.equal(holeLabel({ spec }), "MultiConnect slot 84 long, on-ramps every 28");
  // It is one of the fields that carry across MultiConnect presets.
  const { presetSpecFor } = await import("../../src/lib/screwPresets.js");
  assert.equal(presetSpecFor(spec, getPreset("mc-slot-release").spec).rampEvery, true);
});

test("an openGrid thread is cut by lib/ogthread.scad in the slots' frame, blind or through", () => {
  let { doc } = addHole(createHolesDoc({ kind: "mesh", name: "box", stlBytes: new ArrayBuffer(84), extents: [40, 40, 20] }), {
    point: [20, 0, 10],
    normal: [0, -1, 0],
    spec: getPreset("og-thread").spec,
    presetId: "og-thread",
  });
  ({ doc } = addHole(doc, { point: [20, 20, 20], normal: [0, 0, 1], spec: { ...getPreset("og-thread-lite").spec, depth: 0 } }));
  const scad = holesToScad(doc, partsById, { throughLength: 70, importedFiles: new Map() });
  // BOSL2 at top level (thread_helix() is BOSL2's), then the library.
  assert.match(scad, /^include <\.\.\/vendor\/BOSL2\/std\.scad>\nuse <\.\.\/lib\/ogthread\.scad>$/m);
  assert.match(scad, /og_thread_hole\(depth = 8, clearance = 0\.5, overshoot = 1\);/);
  // Through: as deep as the caller's through length — or, given the
  // base's extents, the box's width along the axis (20 here) plus the
  // overshoot.
  assert.match(scad, /og_thread_hole\(depth = 70, clearance = 0\.5, overshoot = 1\);/);
  assert.match(holesToScad(doc, partsById, { throughLength: 70, extents: [40, 40, 20], importedFiles: new Map() }), /og_thread_hole\(depth = 21, clearance = 0\.5, overshoot = 1\);/);
  // On the front face its +Y is up, as a slot's: x along +X, y along +Z,
  // z out of the face (-Y).
  assert.match(scad, /multmatrix\(\[\[1, 0, 0, 20\], \[0, 0, -1, 0\], \[0, 1, 0, 10\], \[0, 0, 0, 1\]\]\)/);
  assert.equal(holeLabel(doc.holes[0]), "openGrid thread 8 deep");
  assert.equal(holeMeta(doc.holes[1]), "through, turned 0°");
});

test("an openGrid thread turns, flips and keeps its direction like a slot", () => {
  let { doc } = addHole(createHolesDoc({ kind: "mesh", name: "lid", stlBytes: new ArrayBuffer(84), extents: [40, 40, 10] }), {
    point: [0, 0, 10],
    normal: [0, 0, 1],
    spec: getPreset("og-thread").spec,
  });
  doc = rotateHoles(doc, [doc.holes[0].id], 90);
  assert.equal(doc.holes[0].spec.spin, 90);
  assert.equal(flipHoles(doc, 10).holes[0].spec.spin, 270);
  // Normalisation: depth 0 is through; a bad depth falls back to one a
  // full-size screw fits, a bad clearance to upstream's.
  assert.equal(normalizeSpec({ kind: "thread", depth: 0 }).depth, 0);
  assert.deepEqual(normalizeSpec({ kind: "thread", depth: -1, clearance: "x", spin: 450 }), { kind: "thread", depth: 8, clearance: 0.5, spin: 90 });
  // Its outline is the bore and the arrow; its footprint the bore.
  const segments = slotOutline(doc.holes[0]);
  const r = Math.max(...segments.map((seg) => Math.hypot(seg.a[0], seg.a[1])));
  assert.ok(Math.abs(r - 8.25) < 1e-9, `bore radius ${r}`);
  assert.equal(holeFootprintRadius(doc.holes[0].spec), 8.25);
  // The two presets differ in depth only: a deeper full-size thread is
  // edited, a turned one is still the preset; switching between them —
  // or from a slot — keeps the direction.
  assert.ok(specMatchesPreset({ ...getPreset("og-thread").spec, spin: 180 }, "og-thread"));
  assert.ok(!specMatchesPreset({ ...getPreset("og-thread").spec, depth: 12 }, "og-thread"));
  assert.deepEqual(presetSpecFor(doc.holes[0].spec, getPreset("og-thread-lite").spec), { kind: "thread", depth: 4.5, clearance: 0.5, spin: 90 });
  assert.equal(presetSpecFor({ ...getPreset("oc-slot").spec, spin: 270 }, getPreset("og-thread").spec).spin, 270);
});
