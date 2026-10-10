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
  repeatHole,
  repeatPoints,
  isPill,
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
      assert.ok(["openconnect", "multiconnect", "thread", "cylinder", "rectangle", "extrusion", "pinhole", "klippt"].includes(preset.spec.kind), `${preset.id} kind`);
      if ("spin" in preset.spec) assert.equal(preset.spec.spin, 0, `${preset.id} starts unturned`);
    }
    assert.ok(typeof preset.screw.style === "string", `${preset.id} screw style`);
    // The spec round-trips through normalisation unchanged.
    assert.deepEqual(normalizeSpec(preset.spec), preset.spec);
  }
});

test("USB and memory card openings clear what they are named for", () => {
  // [preset, width, thickness of the shell / plug / card it takes]
  const outlines = [
    ["usb-c", 8.94, 3.26], ["usb-c-plug", 12.35, 6.5], ["usb-a", 12.5, 5.12], ["usb-a-plug", 16, 8],
    ["usb-micro", 7.5, 2.5], ["usb-mini", 7.7, 3.9], ["usb-b", 12, 10.9],
    ["sd-slot", 24, 2.1], ["microsd-slot", 11, 1], ["sd-stand", 24, 2.1], ["minisd-stand", 20, 1.4],
    ["microsd-stand", 11, 1], ["cf-stand", 36.4, 3.3], ["cfexpress-a-stand", 20, 2.8], ["cfexpress-b-stand", 29.6, 3.8],
  ];
  for (const [id, w, h] of outlines) {
    const { spec } = getPreset(id);
    assert.ok(spec.width > w && spec.width - w <= 1, `${id} width ${spec.width} for ${w}`);
    assert.ok(spec.height > h && spec.height - h <= 1, `${id} height ${spec.height} for ${h}`);
  }
  // Ports and case slots go through; a holder's slot holds the card half in.
  assert.equal(getPreset("usb-c").spec.depth, 0);
  assert.equal(getPreset("sd-slot").spec.depth, 0);
  assert.equal(getPreset("sd-stand").spec.depth, 16);
  assert.equal(getPreset("microsd-stand").spec.depth, 7.5);
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

test("a round cutout is a plain cylinder, blind or through, with no direction", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("shape-cylinder").spec, presetId: "shape-cylinder" });
  ({ doc } = addHole(doc, { point: [30, 10, 4], normal: [0, 0, 1], spec: { kind: "cylinder", diameter: 12, depth: 2.5 } }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  // Plain OpenSCAD: no library pulled in for it.
  assert.doesNotMatch(scad, /BOSL2|use </);
  assert.match(scad, /translate\(\[0, 0, -50\]\) cylinder\(d = 10, h = 51\);/);
  assert.match(scad, /translate\(\[0, 0, -2\.5\]\) cylinder\(d = 12, h = 3\.5\);/);
  assert.equal(holeLabel(doc.holes[1]), "Round Ø12 2.5 deep");
  assert.equal(holeFootprintRadius(doc.holes[1].spec), 6);
  assert.deepEqual(slotOutline(doc.holes[0]), []);
  const turned = rotateHoles(doc, [doc.holes[0].id], 90);
  assert.deepEqual(turned.holes[0].spec, doc.holes[0].spec);
  assert.deepEqual(normalizeSpec({ kind: "cylinder", diameter: -1, depth: "x", chamfer: -1, teardrop: 1 }), { kind: "cylinder", diameter: 10, depth: 0, chamfer: 0, teardrop: false });
});

test("a rectangle is extruded from its outline in the slots' frame, corners rounded up to a pill", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("shape-rect").spec, presetId: "shape-rect" });
  ({ doc } = addHole(doc, { point: [20, 20, 4], normal: [0, 0, 1], spec: { ...getPreset("shape-rounded").spec, depth: 3 } }));
  ({ doc } = addHole(doc, { point: [30, 30, 4], normal: [0, 0, 1], spec: { ...getPreset("shape-pill").spec, cornerRadius: 99 } }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.doesNotMatch(scad, /BOSL2|use </);
  assert.match(scad, /translate\(\[0, 0, -50\]\) linear_extrude\(height = 51\) square\(\[20, 10\], center = true\);/);
  assert.match(scad, /translate\(\[0, 0, -3\]\) linear_extrude\(height = 4\) hull\(\) for \(x = \[-8, 8\], y = \[-3, 3\]\) translate\(\[x, y\]\) circle\(r = 2\);/);
  // A radius past half the narrower side is cut as the pill: the two
  // circles along the width coincide.
  assert.match(scad, /hull\(\) for \(x = \[-6, 6\], y = \[0, 0\]\) translate\(\[x, y\]\) circle\(r = 4\);/);
  // Its frame is a slot's: unturned on a level face, +Y is the part's Y.
  assert.equal(cutterLines(doc.holes[0], 50)[0], "multmatrix([[1, 0, 0, 10], [0, 1, 0, 10], [0, 0, 1, 4], [0, 0, 0, 1]]) {");
  assert.equal(holeLabel(doc.holes[0]), "Rectangle 20×10, through");
  assert.equal(holeLabel(doc.holes[1]), "Rectangle 20×10, r2, 3 deep");
  assert.equal(holeLabel(doc.holes[2]), "Pill 20×8, through");
  assert.ok(isPill(doc.holes[2].spec) && !isPill(doc.holes[1].spec));
  // Its ring (and click area) is the circle inside it, not round it.
  assert.equal(holeFootprintRadius(doc.holes[0].spec), 5);
  // Its outline is drawn, and closes.
  const outline = slotOutline(doc.holes[1]);
  assert.ok(outline.length > 4);
  assert.deepEqual(outline.at(-1).b, outline[0].a);
});

test("a rectangle turns and flips like a slot, and keeps its direction across shape presets", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("shape-rect").spec, presetId: "shape-rect" });
  doc = rotateHoles(doc, [doc.holes[0].id], 90);
  assert.equal(doc.holes[0].spec.spin, 90);
  assert.equal(holeMeta(doc.holes[0]), "through, turned 90°");
  assert.equal(flipHoles(doc, 4).holes[0].spec.spin, 270);
  // Turned, it is still the preset; resized, it isn't.
  assert.ok(specMatchesPreset(doc.holes[0].spec, "shape-rect"));
  assert.ok(!specMatchesPreset({ ...doc.holes[0].spec, width: 30 }, "shape-rect"));
  assert.deepEqual(presetSpecFor(doc.holes[0].spec, getPreset("shape-pill").spec), { ...getPreset("shape-pill").spec, spin: 90 });
  assert.deepEqual(presetSpecFor(doc.holes[0].spec, getPreset("shape-cylinder").spec), getPreset("shape-cylinder").spec);
  assert.deepEqual(normalizeSpec({ kind: "rectangle", width: 0, height: "x", cornerRadius: -2, spin: -90 }), {
    kind: "rectangle",
    width: 0.1,
    height: 10,
    cornerRadius: 0,
    depth: 0,
    chamfer: 0,
    spin: 270,
  });
});

test("a 2020 socket is cut by lib/exsocket.scad in the slots' frame, keyed or plain", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("ex-socket").spec, presetId: "ex-socket" });
  ({ doc } = addHole(doc, { point: [0, 20, 2], normal: [0, 1, 0], spec: { ...getPreset("ex-socket-plain").spec, depth: 0, clearance: 0.3 } }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  // Its own library, which needs no BOSL2.
  assert.match(scad, /^use <\.\.\/lib\/exsocket\.scad>$/m);
  assert.doesNotMatch(scad, /BOSL2/);
  assert.match(scad, /ex_socket\(depth = 15, clearance = 0\.15, keys = true, chamfer = 0\.5, overshoot = 1\);/);
  assert.match(scad, /ex_socket\(depth = 50, clearance = 0\.3, keys = false, chamfer = 0\.5, overshoot = 1\);/);
  assert.equal(cutterLines(doc.holes[0], 50)[0], "multmatrix([[1, 0, 0, 10], [0, 1, 0, 10], [0, 0, 1, 4], [0, 0, 0, 1]]) {");
  assert.equal(holeLabel(doc.holes[0]), "2020 socket 15 deep, keyed");
  assert.equal(holeLabel(doc.holes[1]), "2020 socket through");
  assert.equal(holeFootprintRadius(doc.holes[0].spec), 10.15);
  // Outline: four corners, plus a notch of four points per key.
  assert.equal(slotOutline(doc.holes[0]).length, 20);
  assert.equal(slotOutline(doc.holes[1]).length, 4);
});

test("a 2020 socket turns and flips like a slot; its presets differ in the keys alone", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("ex-socket").spec, presetId: "ex-socket" });
  doc = rotateHoles(doc, [doc.holes[0].id], 90);
  assert.equal(doc.holes[0].spec.spin, 90);
  assert.equal(flipHoles(doc, 4).holes[0].spec.spin, 270);
  // Deeper or looser, it is still the preset; switching presets keeps
  // depth, clearance and direction.
  assert.ok(specMatchesPreset({ ...doc.holes[0].spec, depth: 25, clearance: 0.3 }, "ex-socket"));
  assert.ok(!specMatchesPreset(doc.holes[0].spec, "ex-socket-plain"));
  assert.deepEqual(presetSpecFor({ ...doc.holes[0].spec, depth: 25, bolt: true }, getPreset("ex-socket-plain").spec), { kind: "extrusion", depth: 25, clearance: 0.15, keys: false, bolt: true, chamfer: 0.5, teardrop: false, spin: 90 });
  assert.deepEqual(normalizeSpec({ kind: "extrusion", depth: -1, clearance: "x", keys: 0, bolt: "yes", spin: 450 }), { kind: "extrusion", depth: 15, clearance: 0.15, keys: true, bolt: false, chamfer: 0, teardrop: false, spin: 90 });
});

test("a 2020 socket's M5 bolt hole runs on from its floor, only when it has one", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: { ...getPreset("ex-socket").spec, bolt: true } });
  ({ doc } = addHole(doc, { point: [30, 10, 4], normal: [0, 0, 1], spec: { ...getPreset("ex-socket").spec, bolt: true, depth: 0 } }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.match(scad, /ex_socket\(depth = 15, clearance = 0\.15, keys = true, bolt = 50, chamfer = 0\.5, overshoot = 1\);/);
  // Through, there is no floor: the option is kept but not cut.
  assert.match(scad, /ex_socket\(depth = 50, clearance = 0\.15, keys = true, chamfer = 0\.5, overshoot = 1\);/);
  assert.equal(holeLabel(doc.holes[0]), "2020 socket 15 deep, keyed, M5 bolt");
  assert.equal(holeLabel(doc.holes[1]), "2020 socket through, keyed");
  // The bolt's circle (dashed) joins the socket's outline.
  assert.equal(slotOutline(doc.holes[0]).length, 20 + 24);
  assert.equal(slotOutline(doc.holes[1]).length, 20);
});

test("a teardrop is cut only on a wall, pointing up; elsewhere a hole stays round", () => {
  const spec = { ...getPreset("shape-cylinder").spec, diameter: 8, depth: 5, teardrop: true };
  let { doc } = addHole(plateDoc(), { point: [0, -20, 2], normal: [0, -1, 0], spec });
  ({ doc } = addHole(doc, { point: [10, 10, 4], normal: [0, 0, 1], spec }));
  const [wall, top] = doc.holes.map((h) => cutterLines(h, 50));
  // On the wall: in the face's upright frame (its +Y is world +Z), a
  // circle with a 45° point at r·√2 straight up.
  assert.equal(wall[0], "multmatrix([[1, 0, 0, 0], [0, 0, -1, -20], [0, 1, 0, 2], [0, 0, 0, 1]]) {");
  assert.match(wall[1], /linear_extrude\(height = 6\) hull\(\) \{ circle\(d = 8\); polygon\(\[\[0, 5\.6569\], \[-2\.8284, 2\.8284\], \[2\.8284, 2\.8284\]\]\); \}/);
  // On a level face the hole is vertical: a plain cylinder, as before.
  assert.match(top[1], /cylinder\(d = 8, h = 6\);/);
  // A screw hole's shank and counterbore go teardrop too; a hex pocket
  // stands on a corner.
  const screwSpec = { ...getPreset("m3-cap").spec, teardrop: true };
  const cap = cutterLines(addHole(plateDoc(), { point: [0, -20, 2], normal: [0, -1, 0], spec: screwSpec }).hole, 50).join("\n");
  assert.equal((cap.match(/polygon/g) ?? []).length, 2);
  const nut = cutterLines(addHole(plateDoc(), { point: [0, -20, 2], normal: [0, -1, 0], spec: { ...getPreset("m3-nut").spec, teardrop: true } }).hole, 50).join("\n");
  assert.match(nut, /rotate\(\[0, 0, 90\]\) cylinder\(d = 6\.7, h = 3\.7, \$fn = 6\);/);
});

test("a 2020 socket's bolt teardrop points up whichever way the socket is turned", () => {
  const spec = { ...getPreset("ex-socket").spec, bolt: true, teardrop: true, spin: 30 };
  const onWall = cutterLines(addHole(plateDoc(), { point: [0, -20, 2], normal: [0, -1, 0], spec }).hole, 50).join("\n");
  assert.match(onWall, /bolt = 50, teardrop = -30, chamfer = 0\.5/);
  const onTop = cutterLines(addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec }).hole, 50).join("\n");
  assert.doesNotMatch(onTop, /teardrop/);
});

test("a chamfer is a 45° hull from the outline down at its depth to the outline grown at the surface", () => {
  const round = cutterLines(addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: { ...getPreset("shape-cylinder").spec, depth: 5, chamfer: 1 } }).hole, 50);
  assert.match(round[1], /translate\(\[0, 0, -5\]\) linear_extrude\(height = 6\) circle\(d = 10\);/);
  assert.equal(round[2].trim(), "hull() { translate([0, 0, -1]) linear_extrude(height = 0.01) circle(d = 10); linear_extrude(height = 1) offset(r = 1) circle(d = 10); }");
  const rect = cutterLines(addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: { ...getPreset("shape-rect").spec, depth: 0.5, chamfer: 2 } }).hole, 50);
  // Never deeper than the cutout.
  assert.match(rect[2], /translate\(\[0, 0, -0\.5\]\) linear_extrude\(height = 0\.01\) square\(\[20, 10\], center = true\); linear_extrude\(height = 1\) offset\(r = 0\.5\)/);
  // Picking another shape keeps the chamfer and teardrop; they don't
  // make the hole "edited" either.
  const chamfered = { ...getPreset("shape-cylinder").spec, chamfer: 1, teardrop: true };
  assert.deepEqual(presetSpecFor(chamfered, getPreset("magnet-6x2").spec), { kind: "cylinder", diameter: 6.2, depth: 2.2, chamfer: 1, teardrop: true });
  assert.ok(specMatchesPreset(chamfered, "shape-cylinder"));
});

test("repeat: a staggered grid is a Skådis board's pattern, cut as Skådis slots", () => {
  let { doc, hole } = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1], spec: getPreset("skadis-slot").spec, presetId: "skadis-slot" });
  // A Skådis board: 40 mm along a row, rows 20 mm apart, every other one
  // shifted half a step.
  const grid = repeatHole(doc, hole.id, { pattern: "grid", columns: 2, rows: 3, spacingAcross: 40, spacingUp: 20, stagger: true });
  assert.deepEqual(grid.doc.holes.map((h) => h.point), [[0, 0, 4], [40, 0, 4], [20, 20, 4], [60, 20, 4], [0, 40, 4], [40, 40, 4]]);
  // The slot itself: an upright pill, 5 mm and a printing allowance wide.
  const { spec } = getPreset("skadis-slot");
  assert.equal(spec.kind, "rectangle");
  assert.equal(spec.height, 15);
  assert.equal(spec.cornerRadius, spec.width / 2);
  assert.ok(isPill(spec) && spec.depth === 0);
});

test("repeat: a circle filled with Skådis spacing is the board's pattern round the hole, which stays put", () => {
  let { doc, hole } = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1], spec: getPreset("skadis-slot").spec, presetId: "skadis-slot" });
  // Within 30 mm: the four diagonal neighbours (28.3 mm), round from up.
  const near = repeatHole(doc, hole.id, { pattern: "circle", skadisFill: true, radius: 30 });
  assert.deepEqual(near.doc.holes.map((h) => h.point), [[0, 0, 4], [20, 20, 4], [20, -20, 4], [-20, -20, 4], [-20, 20, 4]]);
  assert.equal(near.doc.holes[0].id, hole.id);
  // Out to 40 mm the next ones along the row and up the column join them:
  // the row's neighbours 40 mm off, never 20.
  const far = repeatHole(doc, hole.id, { pattern: "circle", skadisFill: true, radius: 40, circleCount: 3, keepCenter: false });
  assert.deepEqual(far.doc.holes.slice(5).map((h) => h.point), [[0, 40, 4], [40, 0, 4], [0, -40, 4], [-40, 0, 4]]);
  assert.ok(far.doc.holes.every((h) => h.presetId === "skadis-slot"));
});

test("repeat: a row, a grid and a circle on the hole's face, in the face's own axes", () => {
  // On the top face: across is +X, up is +Y.
  let { doc, hole } = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1], spec: getPreset("m3-cap").spec, presetId: "m3-cap" });
  const row = repeatHole(doc, hole.id, { pattern: "row", count: 3, spacing: 10 });
  assert.deepEqual(row.doc.holes.map((h) => h.point), [[0, 0, 4], [10, 0, 4], [20, 0, 4]]);
  assert.equal(row.ids.length, 3);
  assert.ok(row.doc.holes.every((h) => h.presetId === "m3-cap" && h.spec.diameter === 3.4));
  assert.deepEqual(repeatHole(doc, hole.id, { pattern: "row", count: 2, spacing: -5, along: "up" }).doc.holes[1].point, [0, -5, 4]);
  const grid = repeatHole(doc, hole.id, { pattern: "grid", columns: 2, rows: 2, spacingAcross: 10, spacingUp: 5 });
  assert.deepEqual(grid.doc.holes.map((h) => h.point), [[0, 0, 4], [10, 0, 4], [0, 5, 4], [10, 5, 4]]);
  // A circle round the hole's spot: it moves to the top of the circle.
  const circle = repeatHole(doc, hole.id, { pattern: "circle", circleCount: 4, radius: 10 });
  const round2 = (p) => p.map((v) => Math.round(v * 1e6) / 1e6 + 0);
  assert.deepEqual(circle.doc.holes.map((h) => round2(h.point)), [[0, 10, 4], [-10, 0, 4], [0, -10, 4], [10, 0, 4]]);
  assert.equal(circle.doc.holes[0].id, hole.id);
  const kept = repeatHole(doc, hole.id, { pattern: "circle", circleCount: 4, radius: 10, keepCenter: true });
  assert.equal(kept.doc.holes.length, 5);
  assert.deepEqual(kept.doc.holes[0].point, [0, 0, 4]);
  // On a wall the axes are the wall's: up is world +Z.
  ({ doc, hole } = addHole(plateDoc(), { point: [0, -20, 2], normal: [0, -1, 0] }));
  assert.deepEqual(repeatHole(doc, hole.id, { pattern: "row", count: 2, spacing: 3, along: "up" }).doc.holes[1].point, [0, -20, 5]);
});

test("repeat: copies off the model, or on a hole already there, are skipped", () => {
  let { doc, hole } = addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1] });
  ({ doc } = addHole(doc, { point: [20, 0, 4], normal: [0, 0, 1] }));
  // Pretend the face ends at x = 25.
  const accept = (p) => p[0] <= 25;
  const r = repeatHole(doc, hole.id, { pattern: "row", count: 4, spacing: 10 }, accept);
  assert.deepEqual(r.doc.holes.map((h) => h.point[0]), [0, 20, 10]);
  assert.equal(r.skipped, 2);
  // A pattern is capped: no thousand cutters from a typo.
  assert.equal(repeatPoints(hole, { pattern: "grid", columns: 50, rows: 50 }).copies.length, 99);
});

test("a BitBeam pin hole is cut by lib/pinhole.scad: grooves at both ends when blind, the entry only when through", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("bitbeam-pin").spec, presetId: "bitbeam-pin" });
  ({ doc } = addHole(doc, { point: [-10, 10, 4], normal: [0, 0, 1], spec: { ...getPreset("bitbeam-pin").spec, depth: 0 } }));
  ({ doc } = addHole(doc, { point: [0, -20, 2], normal: [0, -1, 0], spec: { ...getPreset("bitbeam-pin").spec, teardrop: true } }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.match(scad, /^use <\.\.\/lib\/pinhole\.scad>$/m);
  assert.doesNotMatch(scad, /BOSL2/);
  assert.match(scad, /bb_pinhole\(depth = 8, far_groove = true, overshoot = 1\);/);
  assert.match(scad, /bb_pinhole\(depth = 50, far_groove = false, overshoot = 1\);/);
  // On a wall, a teardrop in the upright frame.
  assert.match(scad, /bb_pinhole\(depth = 8, far_groove = true, teardrop = 0, overshoot = 1\);/);
  assert.equal(holeLabel(doc.holes[0]), "BitBeam pin hole 8 deep");
  assert.equal(holeFootprintRadius(doc.holes[0].spec), 2.5);
  assert.deepEqual(normalizeSpec({ kind: "pinhole", depth: -2 }), { kind: "pinhole", depth: 8, teardrop: false });
});

test("a new hole never takes an id the document already has", () => {
  // A document whose ids the module's counter doesn't know about (as
  // after a hot reload of this module): every id here is taken.
  // The ids the counter hands out next are all taken.
  const next = Number(addHole(plateDoc(), { point: [0, 0, 4], normal: [0, 0, 1] }).hole.id.slice(1)) + 1;
  const taken = Array.from({ length: 5 }, (_, i) => ({ id: `h${next + i}`, point: [i, 0, 0], normal: [0, 0, 1], spec: normalizeSpec({}), presetId: null }));
  const { doc, hole } = addHole({ ...plateDoc(), holes: taken }, { point: [0, 9, 4], normal: [0, 0, 1] });
  assert.ok(!taken.some((h) => h.id === hole.id));
  assert.equal(new Set(doc.holes.map((h) => h.id)).size, doc.holes.length);
});

test("a KLIPPT channel is cut by lib/klippt.scad in the slots' frame, with a pocket or a run-out", () => {
  let { doc } = addHole(plateDoc(), { point: [10, 10, 4], normal: [0, 0, 1], spec: getPreset("klippt-pocket").spec, presetId: "klippt-pocket" });
  ({ doc } = addHole(doc, { point: [0, -20, 2], normal: [0, -1, 0], spec: { ...getPreset("klippt-open").spec, runout: 12, spin: 90 } }));
  const scad = holesToScad(doc, partsById, { throughLength: 50 });
  assert.match(scad, /^use <\.\.\/lib\/klippt\.scad>$/m);
  assert.doesNotMatch(scad, /BOSL2/);
  assert.match(scad, /klippt_channel\(pocket = true, runout = 0, clearance = 0\.3, overshoot = 1\);/);
  assert.match(scad, /klippt_channel\(pocket = false, runout = 12, clearance = 0\.3, overshoot = 1\);/);
  // The slots' frame: unturned on a level face, the base slides along +Y.
  assert.equal(cutterLines(doc.holes[0], 50)[0], "multmatrix([[1, 0, 0, 10], [0, 1, 0, 10], [0, 0, 1, 4], [0, 0, 0, 1]]) {");
  assert.equal(holeLabel(doc.holes[0]), "KLIPPT channel, drop-in pocket");
  assert.equal(holeLabel(doc.holes[1]), "KLIPPT channel, 12 mm run-out, 90°");
  assert.equal(holeMeta(doc.holes[1]), "turned 90°");
  // It turns and flips like a slot; the presets differ in the entry alone.
  assert.equal(rotateHoles(doc, [doc.holes[0].id], 90).holes[0].spec.spin, 90);
  assert.ok(specMatchesPreset({ ...getPreset("klippt-pocket").spec, spin: 180 }, "klippt-pocket"));
  assert.deepEqual(presetSpecFor(doc.holes[1].spec, getPreset("klippt-pocket").spec), { kind: "klippt", pocket: true, runout: 12, clearance: 0.3, spin: 90 });
  // A run-out shorter than a base's tail is lengthened.
  assert.equal(normalizeSpec({ kind: "klippt", pocket: false, runout: 1 }).runout, 3);
  // The clearance defaults to what seats a base free in a rigid part;
  // 0 (the clip exactly) stays 0.
  assert.equal(normalizeSpec({ kind: "klippt" }).clearance, 0.3);
  assert.equal(normalizeSpec({ kind: "klippt", clearance: 0 }).clearance, 0);
  // Its outline closes, with the arrow.
  assert.ok(slotOutline(doc.holes[0]).length > 12);
});
