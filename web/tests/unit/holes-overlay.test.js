import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  HOLE_COLOR,
  REPEAT_PREVIEW_COLOR,
  SELECTED_COLOR,
  SNAP_COLORS,
  faceMeasurements,
  holeGuides,
  holeMarkers,
  onFacePlane,
} from "../../src/lib/holesOverlay.js";
import { analyzeFace } from "../../src/lib/snapCandidates.js";
import { addHole, createHolesDoc, normalizeSpec } from "../../src/lib/screwHoles.js";

// A 20 x 10 x 4 box's top face (z = 2), analysed as the Holes tab does.
function topFace(options = { inset: 2 }) {
  const geometry = new BoxGeometry(20, 10, 4);
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  const welded = mergeVertices(geometry, 1e-3);
  const index = welded.index;
  const position = welded.attributes.position;
  for (let t = 0; t < index.count / 3; t++) {
    if ([0, 1, 2].every((k) => position.getZ(index.getX(3 * t + k)) >= 1.99))
      return analyzeFace(welded, t, options);
  }
  throw new Error("no top triangle");
}

function twoHoleDoc() {
  let doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: {} });
  ({ doc } = addHole(doc, { point: [-5, 0, 2], normal: [0, 0, 1] }));
  ({ doc } = addHole(doc, { point: [5, 0, 2], normal: [0, 0, 1] }));
  return doc;
}

const base = { selectedIds: [], repeatResult: null, hover: null, guideFace: null, snapOn: true, snapDot: 1 };

test("holeMarkers: no document, no markers", () => {
  assert.deepEqual(holeMarkers({ ...base, doc: null }), []);
});

test("holeMarkers: a ring per hole, the selected one in the selection colour", () => {
  const doc = twoHoleDoc();
  const markers = holeMarkers({ ...base, doc, selectedIds: [doc.holes[1].id] });
  assert.deepEqual(
    markers.map((m) => [m.id, m.shape, m.color]),
    [
      [`hole:${doc.holes[0].id}`, "ring", HOLE_COLOR],
      [`hole:${doc.holes[1].id}`, "ring", SELECTED_COLOR],
    ],
  );
  assert.deepEqual([markers[0].x, markers[0].y, markers[0].z], [-5, 0, 2]);
  assert.ok(markers[0].radius > 0.5);
});

test("holeMarkers: Repeat copies show unless they sit where a hole already is; they take no clicks", () => {
  const doc = twoHoleDoc();
  const moved = { ...doc.holes[0], point: [-6, 0, 2] };
  const copy = { ...doc.holes[0], id: "copy", point: [0, 0, 2] };
  const repeatResult = { doc: { ...doc, holes: [moved, doc.holes[1], copy] } };
  const repeats = holeMarkers({ ...base, doc, repeatResult }).filter((m) => m.id.startsWith("repeat:"));
  assert.deepEqual(
    repeats.map((m) => [m.id, m.color, m.hitTest]),
    [
      [`repeat:${doc.holes[0].id}`, REPEAT_PREVIEW_COLOR, false],
      ["repeat:copy", REPEAT_PREVIEW_COLOR, false],
    ],
  );
});

test("holeMarkers: the guide face's snap points, the hovered one enlarged; none with snapping off", () => {
  const guideFace = topFace();
  const doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: {} });
  const target = guideFace.candidates[0];
  const hover = { faceKey: guideFace.key, snapId: target.id, linePoint: null };
  const markers = holeMarkers({ ...base, doc, guideFace, hover, snapDot: 1 });
  assert.equal(markers.length, guideFace.candidates.length);
  const active = markers.find((m) => m.id === `snap:${target.id}`);
  assert.equal(active.color, SELECTED_COLOR);
  assert.equal(active.radius, 1.7);
  const other = markers.find((m) => m.id === `snap:${guideFace.candidates[1].id}`);
  assert.equal(other.radius, 1);
  assert.equal(other.color, SNAP_COLORS[guideFace.candidates[1].kind] ?? SNAP_COLORS.quarter);

  assert.deepEqual(holeMarkers({ ...base, doc, guideFace, hover, snapOn: false }), []);
});

test("holeMarkers: a spot on a guide line gets a display-only marker", () => {
  const doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: {} });
  const hover = { faceKey: 0, snapId: null, linePoint: [1, 2, 3] };
  const [line] = holeMarkers({ ...base, doc, hover, snapDot: 2 });
  assert.deepEqual(
    [line.id, line.x, line.y, line.z, line.radius, line.hitTest],
    ["snap:line", 1, 2, 3, 2.8, false],
  );
});

test("holeGuides: the guide face's lines lifted off it, center lines solid and the rest dashed", () => {
  const guideFace = topFace({ inset: 2, radius: 3 });
  const segments = holeGuides({ holes: [], selectedIds: [], guideFace, snapOn: true });
  assert.ok(segments.length >= guideFace.guides.length);
  for (const s of segments) {
    assert.ok(s.a[2] > 2 && s.a[2] < 2.1, "lifted above the face, by less than a tenth");
  }
  const center = guideFace.guides.find((g) => g.kind === "center");
  assert.ok(segments.some((s) => !s.dashed && s.a[0] === center.a[0] && s.a[1] === center.a[1]));
  assert.ok(segments.some((s) => s.dashed));
  assert.deepEqual(holeGuides({ holes: [], selectedIds: [], guideFace, snapOn: false }), []);
});

test("holeGuides: a connector slot's outline, in the selection colour when selected", () => {
  let doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: {} });
  const spec = normalizeSpec({ kind: "multiconnect", length: 20, onRamp: true, detent: true, spin: 0 });
  ({ doc } = addHole(doc, { point: [0, 0, 2], normal: [0, 0, 1], spec }));
  const [hole] = doc.holes;
  const plain = holeGuides({ holes: doc.holes, selectedIds: [], guideFace: null, snapOn: true });
  assert.ok(plain.length > 0);
  assert.ok(
    plain.every((s) => s.a[2] > 2),
    "lifted off the face",
  );
  assert.ok(plain.every((s) => s.color === HOLE_COLOR));
  const picked = holeGuides({ holes: doc.holes, selectedIds: [hole.id], guideFace: null, snapOn: true });
  assert.ok(picked.every((s) => s.color === SELECTED_COLOR));
});

test("faceMeasurements: the face's size always; distances only for a point on the face", () => {
  // Which way the face's u/v frame runs is analyzeFace()'s choice, so
  // the size and the four sides are compared without their order.
  const face = topFace();
  const sizeOnly = faceMeasurements(face, null);
  assert.deepEqual(sizeOnly.guides, []);
  assert.deepEqual(
    sizeOnly.labels.map((l) => [l.id, l.text]),
    [["size", face.extent[0] > face.extent[1] ? "20.0 × 10.0 mm" : "10.0 × 20.0 mm"]],
  );
  assert.deepEqual(faceMeasurements(face, [0, 0, 5]).guides, []);

  const { guides, labels } = faceMeasurements(face, [5, 0, 2]);
  const sides = labels.filter((l) => ["left", "right", "down", "up"].includes(l.id));
  assert.deepEqual(sides.map((l) => l.text).sort(), ["15.0 mm", "5.0 mm", "5.0 mm", "5.0 mm"]);
  assert.equal(labels.find((l) => l.id === "center").text, "5.0 mm to center");
  assert.equal(guides.length, 5);
  assert.equal(guides.filter((g) => g.dashed).length, 1);
});

test("faceMeasurements: at the center, no line to it", () => {
  const { labels } = faceMeasurements(topFace(), [0, 0, 2]);
  assert.ok(!labels.some((l) => l.id === "center"));
});

test("onFacePlane: within 0.05 mm of the face's plane", () => {
  const face = topFace();
  assert.ok(onFacePlane(face, [3, 3, 2.04]));
  assert.ok(!onFacePlane(face, [3, 3, 2.06]));
});
