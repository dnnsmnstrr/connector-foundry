import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, ExtrudeGeometry, Path, Shape } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { analyzeFace, edgeDistances, gridPoint, nearestCandidate, nearestGuide } from "../../src/lib/snapCandidates.js";

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

test("guide lines: two center lines and four quarter lines, clipped to the face, with their crossings as snap points", () => {
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const face = analyzeFace(geometry, topTriangle(geometry, 1.99), { inset: 2, radius: 0 });

  const centers = face.guides.filter((g) => g.kind === "center");
  const quarters = face.guides.filter((g) => g.kind === "quarter");
  assert.equal(centers.length, 2);
  assert.equal(quarters.length, 4);
  // Each line spans the face exactly: a center line along u runs the
  // full 20 mm, a quarter line across it the full 10 mm.
  const length = (g) => Math.hypot(g.a[0] - g.b[0], g.a[1] - g.b[1], g.a[2] - g.b[2]);
  assert.deepEqual(new Set([...centers, ...quarters].map((g) => Math.round(length(g)))), new Set([10, 20]));
  for (const g of [...centers, ...quarters]) assert.equal(Math.round(g.a[2] * 100) / 100, 2);
  // One radial per corner inset, from the center to the corner itself.
  const radials = face.guides.filter((g) => g.kind === "radial");
  assert.equal(radials.length, 4);
  for (const g of radials) {
    assert.deepEqual(round(g.a), [0, 0, 2]);
    assert.deepEqual(round(g.b).map(Math.abs), [10, 5, 2]);
  }
  assert.equal(face.guides.filter((g) => g.kind === "circle").length, 0);

  assert.deepEqual(new Set(byKind(face, "intersection").map(String)), new Set([[5, 0, 2], [-5, 0, 2], [0, 2.5, 2], [0, -2.5, 2]].map(String)));
});

test("near a guide line but no point, the hit slides onto the line and rounds along it", () => {
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const face = analyzeFace(geometry, topTriangle(geometry, 1.99), { inset: 2, radius: 0 });

  const onCenter = nearestGuide(face, [2.3, 0.4, 2], 1.5);
  assert.equal(onCenter.guide.kind, "center");
  assert.equal(onCenter.label, "on the center line");
  // Rounding along the line is in the face's own frame; the point lands
  // exactly on v = 0.
  assert.deepEqual(round(onCenter.point).map(Math.abs), [2.5, 0, 2]);
  const onQuarter = nearestGuide(face, [1, 2.2, 2], 1.5);
  assert.equal(onQuarter.guide.kind, "quarter");
  // Off every line (the radial toward (10, 5) passes 0.45 mm from here).
  assert.equal(nearestGuide(face, [2.2, 0.6, 2], 0.3), null);
  // Past the end of a line it is not "on" it.
  assert.equal(nearestGuide(face, [14, 0.1, 2], 1.5), null);
});

test("the center circle: drawn at the chosen radius, snap points where it meets the center lines and radials, clicks slide onto it", () => {
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const face = analyzeFace(geometry, topTriangle(geometry, 1.99), { inset: 2, radius: 3 });

  const circle = face.guides.find((g) => g.kind === "circle");
  assert.equal(circle.radius, 3);
  for (const p of circle.points) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 3) < 1e-9);

  const onCircle = byKind(face, "circle");
  assert.equal(onCircle.length, 8);
  for (const q of [[3, 0, 2], [-3, 0, 2], [0, 3, 2], [0, -3, 2]]) assert.ok(onCircle.some((p) => String(p) === String(q)), `missing ${q}`);
  // Toward a corner (10, 5): 3 mm out along that direction.
  const toward = [Math.round((3 * 10) / Math.hypot(10, 5) * 100) / 100, Math.round((3 * 5) / Math.hypot(10, 5) * 100) / 100, 2];
  assert.ok(onCircle.some((p) => String(p) === String(toward)), `missing ${toward}`);

  const slid = nearestGuide(face, [2.9, 0.15, 2], 1.5);
  assert.equal(slid.guide.kind, "circle");
  assert.equal(slid.label, "on the center circle");
  assert.ok(Math.abs(Math.hypot(slid.point[0], slid.point[1]) - 3) < 1e-9);
  // A radial is a line too: a point near the one toward (10, 5) slides onto it.
  const radial = nearestGuide(face, [4, 1.7, 2], 0.5);
  assert.equal(radial.guide.kind, "radial");
  assert.ok(Math.abs(radial.point[1] / radial.point[0] - 0.5) < 1e-6);

  // A radius wider than the face draws no circle (and its points fall off the face).
  const wide = analyzeFace(geometry, topTriangle(geometry, 1.99), { inset: 2, radius: 30 });
  assert.equal(wide.guides.filter((g) => g.kind === "circle").length, 0);
  assert.equal(byKind(wide, "circle").length, 0);
});

test("edge distances: from a point on the face to the outline each way, and to the center", () => {
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const face = analyzeFace(geometry, topTriangle(geometry, 1.99), { inset: 2, radius: 0 });
  const d = edgeDistances(face, [3, 1, 2]);
  // The face's u axis runs along -y here (planeBasis for +Z), so "left"
  // and "right" are along y and "down"/"up" along x; the four distances
  // are the two pairs 4/6 and 7/13 either way round.
  assert.deepEqual([d.left + d.right, d.down + d.up].sort(), [10, 20]);
  assert.deepEqual([d.left, d.right, d.down, d.up].map((n) => Math.round(n * 100) / 100).sort((a, b) => a - b), [4, 6, 7, 13]);
  assert.ok(Math.abs(d.toCenter - Math.hypot(3, 1)) < 1e-9);
  for (const end of Object.values(d.ends)) assert.equal(Math.round(end[2] * 100) / 100, 2);
  assert.equal(edgeDistances(face, [30, 0, 2]), null);
});

test("a face index the mesh doesn't have is no face, not a crash", () => {
  // The Holes tab keeps the guide face by triangle index; after a
  // re-render with fewer triangles (a hole deleted), an old index can
  // point past the end of the new mesh.
  const geometry = welded(new BoxGeometry(20, 10, 4));
  const triangles = geometry.index.count / 3;
  assert.ok(analyzeFace(geometry, triangles - 1));
  assert.equal(analyzeFace(geometry, triangles), null);
  assert.equal(analyzeFace(geometry, triangles + 500), null);
  assert.equal(analyzeFace(geometry, -1), null);
});
