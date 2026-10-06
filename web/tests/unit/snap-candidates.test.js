import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, ExtrudeGeometry, Path, Shape } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { analyzeFace, gridPoint, nearestCandidate } from "../../src/lib/snapCandidates.js";

// The welded, indexed geometry the Holes tab analyses (see Holes.jsx).
function welded(geometry) {
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  return mergeVertices(geometry, 1e-3);
}

// The first triangle whose three vertices all sit at z >= zMin: a
// triangle of the top face.
function topTriangle(geometry, zMin) {
  const index = geometry.index;
  const position = geometry.attributes.position;
  for (let t = 0; t < index.count / 3; t++) {
    if ([0, 1, 2].every((k) => position.getZ(index.getX(3 * t + k)) >= zMin)) return t;
  }
  throw new Error("no top triangle");
}

const round = (p) => p.map((n) => Math.round(n * 100) / 100 || 0); // || 0 folds -0 into 0
const byKind = (face, kind) => face.candidates.filter((c) => c.kind === kind).map((c) => round(c.point));

test("a box's top face: center, four quadrant centers, four corner insets — no edge midpoints", () => {
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const face = analyzeFace(geometry, topTriangle(geometry, 1.99), { inset: 2 });

  assert.deepEqual(round(face.normal), [0, 0, 1]);
  assert.deepEqual(round(face.center), [0, 0, 2]);
  assert.deepEqual(byKind(face, "center"), [[0, 0, 2]]);
  assert.deepEqual(new Set(byKind(face, "quarter").map(String)), new Set([[-5, -2.5, 2], [5, -2.5, 2], [5, 2.5, 2], [-5, 2.5, 2]].map(String)));
  assert.deepEqual(new Set(byKind(face, "corner").map(String)), new Set([[-8, -3, 2], [8, -3, 2], [8, 3, 2], [-8, 3, 2]].map(String)));
  assert.equal(byKind(face, "hole").length, 0);
  assert.equal(byKind(face, "edge").length, 0);
});

test("a hole through the face is a snap point at its center; nothing lands inside it", () => {
  const outline = new Shape();
  outline.moveTo(-15, -10);
  outline.lineTo(15, -10);
  outline.lineTo(15, 10);
  outline.lineTo(-15, 10);
  outline.closePath();
  const hole = new Path();
  hole.absarc(5, 0, 2, 0, Math.PI * 2, true);
  outline.holes.push(hole);
  const geometry = welded(new ExtrudeGeometry(outline, { depth: 4, bevelEnabled: false, curveSegments: 16 }));
  const face = analyzeFace(geometry, topTriangle(geometry, 3.99), { inset: 3 });

  const holes = face.candidates.filter((c) => c.kind === "hole");
  assert.equal(holes.length, 1);
  assert.deepEqual(round(holes[0].point), [5, 0, 4]);
  assert.ok(Math.abs(holes[0].radius - 2) < 0.05, `radius ${holes[0].radius}`);
  assert.deepEqual(byKind(face, "center"), [[0, 0, 4]]);
  assert.equal(byKind(face, "quarter").length, 4);
  assert.equal(byKind(face, "corner").length, 4);
  // A hole loop never counts as the outline, however it is wound.
  assert.equal(face.loops.filter((l) => l.outer).length, 1);
});

test("a rounded plate still gets its corner points where the sharp corners would be", () => {
  const w = 20, h = 20, r = 3;
  const outline = new Shape();
  outline.moveTo(-w + r, -h);
  outline.lineTo(w - r, -h);
  outline.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  outline.lineTo(w, h - r);
  outline.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  outline.lineTo(-w + r, h);
  outline.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  outline.lineTo(-w, -h + r);
  outline.absarc(-w + r, -h + r, r, Math.PI, 1.5 * Math.PI, false);
  const geometry = welded(new ExtrudeGeometry(outline, { depth: 4, bevelEnabled: false, curveSegments: 8 }));
  const face = analyzeFace(geometry, topTriangle(geometry, 3.99), { inset: 5 });

  assert.deepEqual(new Set(byKind(face, "corner").map(String)), new Set([[15, 15, 4], [-15, 15, 4], [-15, -15, 4], [15, -15, 4]].map(String)));
  assert.deepEqual(new Set(byKind(face, "quarter").map(String)), new Set([[10, 10, 4], [-10, 10, 4], [-10, -10, 4], [10, -10, 4]].map(String)));
});

test("nearest snap within reach, the face grid otherwise; both cached per face", () => {
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const t = topTriangle(geometry, 1.99);
  const face = analyzeFace(geometry, t, { inset: 2 });
  assert.equal(nearestCandidate(face, [5.4, 2.2, 2], 1.5).kind, "quarter");
  assert.equal(nearestCandidate(face, [9.2, 0.3, 2], 1.5), null);
  assert.deepEqual(round(gridPoint(face, [1.26, -2.74, 2])), [1.5, -2.5, 2]);
  // The same face from another of its triangles is the same cached record.
  const other = [...Array(geometry.index.count / 3).keys()].find((i) => i !== t && face.triangles.includes(i));
  assert.equal(analyzeFace(geometry, other, { inset: 2 }), face);
  // A different inset recomputes the corners only.
  assert.deepEqual(new Set(byKind(analyzeFace(geometry, t, { inset: 1 }), "corner").map(String)), new Set([[-9, -4, 2], [9, -4, 2], [9, 4, 2], [-9, 4, 2]].map(String)));
});
