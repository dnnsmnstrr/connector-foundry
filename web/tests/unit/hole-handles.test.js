import test from "node:test";
import assert from "node:assert/strict";

import {
  HOLE_MIN_MM,
  dragHoleResize,
  holeCross,
  holeFrame,
  holeHandles,
  holeMoveText,
  holeOutline,
  holePillAnchor,
  holeReach,
  holeResizeText,
  moveHole,
  movedOnFace,
  nudgeHoles,
  oppositeSide,
  resizableHole,
  stepHoleSize,
  typedHoleSize,
} from "../../src/lib/holeHandles.js";
import { addHole, createHolesDoc, holeFootprintRadius, normalizeSpec } from "../../src/lib/screwHoles.js";

const close = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
const rect = (extra = {}) => normalizeSpec({ kind: "rectangle", width: 20, height: 10, ...extra });
const round = (diameter = 10) => normalizeSpec({ kind: "cylinder", diameter });
// A hole on a plate's top face (normal +Z): the face's sideways is +X and
// its up is +Y there (slotFrame() uses +Y on a face lying flat).
const onTop = (spec, point = [0, 0, 2]) => ({ id: "h1", point, normal: [0, 0, 1], spec, presetId: null });
const handle = (hole, side) => holeHandles(hole, 1).find((h) => h.id === `${hole.id}:${side}`);

test("a rectangle gets a move handle, four edges and four corners, all on its face plane", () => {
  const hole = onTop(rect());
  const handles = holeHandles(hole, 3);
  assert.deepEqual(
    handles.map((h) => h.id),
    ["h1:move", "h1:w+", "h1:w-", "h1:h+", "h1:h-", "h1:w+h+", "h1:w+h-", "h1:w-h+", "h1:w-h-"],
  );
  assert.ok(close(handle(hole, "move").point, [0, 0, 2]));
  assert.ok(close(handle(hole, "w+").point, [10, 0, 2]));
  assert.ok(close(handle(hole, "w-").point, [-10, 0, 2]));
  assert.ok(close(handle(hole, "h+").point, [0, 5, 2]));
  assert.ok(close(handle(hole, "w-h-").point, [-10, -5, 2]));
  assert.ok(close(handle(hole, "w+").dir, [1, 0, 0]));
  assert.ok(close(handle(hole, "w+h+").dir, [Math.SQRT1_2, Math.SQRT1_2, 0]));
  for (const h of handles) assert.deepEqual(h.constraint, { type: "plane", normal: [0, 0, 1] });
  // Every edge is a Tab stop and opens the size box; corners and the move
  // handle are pointer-only.
  assert.deepEqual(
    handles.filter((h) => h.tabbable).map((h) => h.id),
    ["h1:w+", "h1:w-", "h1:h+", "h1:h-"],
  );
  assert.deepEqual(
    handles.filter((h) => h.editable).map((h) => h.id),
    ["h1:w+", "h1:w-", "h1:h+", "h1:h-"],
  );
  assert.equal(handle(hole, "w+").label, "Hole 1 width (right edge)");
  assert.equal(handles[0].label, "Move hole 3");
  assert.equal(handle(hole, "h-").valueText, "10 mm");
  assert.equal(handle(hole, "h-").editLabel, "Height (mm)");
  assert.equal(handle(hole, "w+h-").valueText, "20 × 10 mm");
});

test("a turned rectangle's handles turn with it", () => {
  const hole = onTop(rect({ spin: 90 }));
  // Turned a quarter counter-clockwise: its width runs along the face's up.
  assert.ok(close(handle(hole, "w+").point, [0, 10, 2]));
  assert.ok(close(handle(hole, "h+").point, [-5, 0, 2]));
});

test("a round cutout has four rim handles on the face's sideways and up; a screw only moves", () => {
  const hole = onTop(round(10));
  assert.deepEqual(
    holeHandles(hole, 1).map((h) => h.id),
    ["h1:move", "h1:d:x+", "h1:d:x-", "h1:d:y+", "h1:d:y-"],
  );
  assert.ok(close(handle(hole, "d:x+").point, [5, 0, 2]));
  assert.ok(close(handle(hole, "d:y-").point, [0, -5, 2]));
  assert.equal(handle(hole, "d:y+").valueText, "Ø10 mm");
  // On a wall facing -Y, up is world +Z.
  const wall = { id: "h2", point: [0, -5, 3], normal: [0, -1, 0], spec: round(4), presetId: null };
  assert.ok(close(handle(wall, "d:y+").point, [0, -5, 5]));

  const screw = onTop(normalizeSpec({ kind: "screw", diameter: 3.4 }));
  assert.equal(resizableHole(screw.spec), false);
  assert.deepEqual(
    holeHandles(screw, 1).map((h) => h.id),
    ["h1:move"],
  );
  assert.deepEqual(holeHandles({ ...screw, point: [NaN, 0, 0] }, 1), []);
});

test("a turned rectangle resizes along its own sides, and a wall's hole along the wall", () => {
  // Turned a quarter: its width runs along the face's up (+Y), so the
  // right edge's drag grows it along +Y and the far edge (y = -10) stays.
  const turned = onTop(rect({ spin: 90 }));
  assert.ok(close(holeFrame(turned).ex, [0, 1, 0]));
  // A round cutout's frame is the face's own, whatever spin it carries.
  assert.ok(close(holeFrame(onTop(normalizeSpec({ kind: "cylinder", spin: 90 }))).ex, [1, 0, 0]));
  const r = dragHoleResize({ hole: turned, handle: handle(turned, "w+"), point: [3, 14, 2], gridMm: 1 });
  assert.deepEqual(r.sizes, [24, 10]);
  assert.ok(close(r.point, [0, 2, 2]));
  assert.ok(close([r.point[1] - r.sizes[0] / 2], [-10]));
  // A typed height on it: its height runs along the face's sideways.
  const typed = typedHoleSize({ hole: turned, handle: handle(turned, "h+"), mm: 16 });
  assert.deepEqual(typed.sizes, [20, 16]);
  assert.ok(close(typed.point, [-3, 0, 2]));

  // On a wall facing -Y the face's up is world +Z and its sideways ±X:
  // every handle, and every resize, stays in the wall's plane (y = -5).
  const wall = { id: "w", point: [0, -5, 3], normal: [0, -1, 0], spec: rect(), presetId: null };
  for (const h of holeHandles(wall, 1)) assert.ok(Math.abs(h.point[1] + 5) < 1e-9, h.id);
  const up = dragHoleResize({ hole: wall, handle: handle(wall, "h+"), point: [0, -5, 10], gridMm: 0.5 });
  assert.deepEqual(up.sizes, [20, 12]);
  assert.ok(close(up.point, [0, -5, 4]));
  const moved = moveHole({ hole: wall, point: [0.2, -5.4, 5.1], gridMm: 0.5 });
  // Off the plane (y = -5.4) counts for nothing; 2.1 up rounds to 2.
  assert.deepEqual(moved.offset.map(Math.abs), [0, 2]);
  assert.ok(close(moved.point, [0, -5, 5]));
  assert.equal(holeMoveText(moved.offset), "2 mm up");

  // A round cutout's typed diameter, from its left rim, keeps its right one.
  const disc = onTop(round(10));
  const wide = typedHoleSize({ hole: disc, handle: handle(disc, "d:x-"), mm: 14 });
  assert.equal(wide.spec.diameter, 14);
  assert.ok(close([wide.point[0] + 7], [5]));
});

test("the side across the hole stays put: its opposite", () => {
  assert.deepEqual(["w+", "w-", "h+", "w+h-", "w-h-", "d:x+", "d:y-", "move"].map(oppositeSide), [
    "w-",
    "w+",
    "h-",
    "w-h+",
    "w+h+",
    "d:x-",
    "d:y+",
    "move",
  ]);
});

test("a drag keeps the opposite edge: the size grows by the travel, the point by half", () => {
  const hole = onTop(rect());
  const w = handle(hole, "w+");
  const r = dragHoleResize({ hole, handle: w, point: [14, 3, 2], gridMm: 0.5 });
  assert.deepEqual(r.sizes, [24, 10]);
  assert.deepEqual(r.deltas, [4, 0]);
  assert.ok(close(r.point, [2, 0, 2]));
  // The left edge is still at x = -10.
  assert.ok(close([r.point[0] - r.sizes[0] / 2], [-10]));
  assert.equal(r.changed, true);
  assert.equal(holeResizeText(hole, w, r), "W 24 mm (+4)");

  // The left edge dragged out keeps the right edge.
  const left = dragHoleResize({ hole, handle: handle(hole, "w-"), point: [-12, 0, 2], gridMm: 0.5 });
  assert.deepEqual(left.sizes, [22, 10]);
  assert.ok(close(left.point, [-1, 0, 2]));
});

test("Alt grows about the centre: twice the travel, the point stays", () => {
  const hole = onTop(rect());
  const h = handle(hole, "h+");
  const r = dragHoleResize({ hole, handle: h, point: [0, 7, 2], symmetric: true, gridMm: 0.5 });
  assert.deepEqual(r.sizes, [20, 14]);
  assert.ok(close(r.point, [0, 0, 2]));
  assert.equal(holeResizeText(hole, h, r, true), "H 14 mm (+2 each side)");
});

test("sizes land on the grid (absolute, not relative to the start), 0.01 mm with it off, never under the floor", () => {
  const hole = onTop(rect({ width: 20.3 }));
  const w = handle(hole, "w+");
  // 20.3 + 1.1 = 21.4 → 21.5 on a 0.5 grid.
  assert.equal(
    dragHoleResize({ hole, handle: w, point: [w.point[0] + 1.1, 0, 2], gridMm: 0.5 }).sizes[0],
    21.5,
  );
  assert.equal(dragHoleResize({ hole, handle: w, point: [w.point[0] + 1.1, 0, 2], gridMm: 2 }).sizes[0], 22);
  assert.equal(
    dragHoleResize({ hole, handle: w, point: [w.point[0] + 1.123, 0, 2], gridMm: 0 }).sizes[0],
    21.42,
  );
  const crushed = dragHoleResize({ hole, handle: w, point: [-40, 0, 2], gridMm: 0.5 });
  assert.equal(crushed.sizes[0], HOLE_MIN_MM);
  // The left edge held: x = -10.15 still.
  assert.ok(close([crushed.point[0] - HOLE_MIN_MM / 2], [-10.15]));
  // Pulled back onto its own size: nothing changes.
  const none = dragHoleResize({ hole, handle: w, point: w.point, gridMm: 0 });
  assert.equal(none.changed, false);
  assert.ok(close(none.point, hole.point));
});

test("a corner drives both sizes from the opposite corner; a pill stays a pill", () => {
  const hole = onTop(rect());
  const c = handle(hole, "w+h-");
  const r = dragHoleResize({ hole, handle: c, point: [12, -8, 2], gridMm: 1 });
  assert.deepEqual(r.sizes, [22, 13]);
  // The top-left corner (-10, 5) stays.
  assert.ok(close(r.point, [1, -1.5, 2]));
  assert.equal(holeResizeText(hole, c, r), "W 22 × H 13 mm");

  const pill = onTop(rect({ width: 20, height: 8, cornerRadius: 4 }));
  const grown = dragHoleResize({ hole: pill, handle: handle(pill, "h+"), point: [0, 6, 2], gridMm: 1 });
  assert.equal(grown.spec.height, 10);
  assert.equal(grown.spec.cornerRadius, 5);
  const rounded = onTop(rect({ cornerRadius: 2 }));
  const kept = dragHoleResize({ hole: rounded, handle: handle(rounded, "h+"), point: [0, 9, 2], gridMm: 1 });
  assert.equal(kept.spec.cornerRadius, 2);
});

test("a round cutout's rim handle grows the diameter from the far side of the rim", () => {
  const hole = onTop(round(10));
  const right = handle(hole, "d:x+");
  const r = dragHoleResize({ hole, handle: right, point: [7, 1, 2], gridMm: 0.5 });
  assert.equal(r.spec.diameter, 12);
  assert.ok(close(r.point, [1, 0, 2]));
  assert.equal(holeResizeText(hole, right, r), "Ø 12 mm (+2)");
  const sym = dragHoleResize({ hole, handle: handle(hole, "d:y-"), point: [0, -6, 2], symmetric: true });
  assert.equal(sym.spec.diameter, 12);
  assert.ok(close(sym.point, [0, 0, 2]));
});

test("non-finite input never reaches the document; a flick is capped", () => {
  const hole = onTop(rect());
  const w = handle(hole, "w+");
  assert.equal(dragHoleResize({ hole, handle: w, point: [NaN, 0, 2] }), null);
  assert.equal(dragHoleResize({ hole, handle: w, point: [Infinity, 0, 2] }), null);
  assert.equal(dragHoleResize({ hole, handle: handle(hole, "move"), point: [1, 0, 2] }), null);
  // 4 × the larger size (80 mm) without a limit; the model's size with one.
  assert.equal(dragHoleResize({ hole, handle: w, point: [1e6, 0, 2] }).sizes[0], 100);
  assert.equal(dragHoleResize({ hole, handle: w, point: [1e6, 0, 2], limitMm: 200 }).sizes[0], 220);
  assert.equal(typedHoleSize({ hole, handle: w, mm: NaN }), null);
  assert.equal(stepHoleSize({ hole, handle: w, steps: NaN }), null);
});

test("a typed size is exact (to 0.01 mm) from the opposite edge; arrow steps land on grid lines", () => {
  const hole = onTop(rect({ width: 20.3 }));
  const w = handle(hole, "w-");
  const typed = typedHoleSize({ hole, handle: w, mm: 25.257 });
  assert.equal(typed.spec.width, 25.26);
  // The right edge (x = 10.15) stays.
  assert.ok(close([typed.point[0] + typed.sizes[0] / 2], [10.15]));
  assert.equal(typedHoleSize({ hole, handle: w, mm: -3 }).spec.width, HOLE_MIN_MM);

  // From 20.3 on a 0.5 grid: up is 20.5, down is 20.
  assert.equal(stepHoleSize({ hole, handle: w, steps: 1, gridMm: 0.5 }).spec.width, 20.5);
  assert.equal(stepHoleSize({ hole, handle: w, steps: -1, gridMm: 0.5 }).spec.width, 20);
  assert.equal(stepHoleSize({ hole, handle: w, steps: 10, gridMm: 1 }).spec.width, 30);
  // Grid off: 0.1 mm a step.
  assert.equal(stepHoleSize({ hole, handle: w, steps: 1, gridMm: 0 }).spec.width, 20.4);
  const stepped = stepHoleSize({
    hole: onTop(round(10)),
    handle: handle(onTop(round(10)), "d:y+"),
    steps: 2,
  });
  assert.equal(stepped.spec.diameter, 10.2);
  assert.ok(close(stepped.point, [0, 0.1, 2]));
});

test("the move handle carries the hole in whole grid steps from where it was, Shift freely", () => {
  const hole = onTop(rect(), [0.3, 0, 2]);
  const moved = moveHole({ hole, point: [3.4, -1.7, 2], gridMm: 0.5 });
  // 3.1 → 3, -1.7 → -1.5: steps counted from 0.3, so x lands on 3.3.
  assert.deepEqual(moved.offset, [3, -1.5]);
  assert.ok(close(moved.point, [3.3, -1.5, 2]));
  assert.equal(holeMoveText(moved.offset), "3 mm right, 1.5 mm down");
  const free = moveHole({ hole, point: [3.4, -1.7, 2], gridMm: 0.5, free: true });
  assert.ok(close(free.point, [3.4, -1.7, 2]));
  assert.ok(close(moveHole({ hole, point: [3.4, -1.7, 2], gridMm: 0 }).point, [3.4, -1.7, 2]));
  // Off the plane (the screen-space fallback's rounding): projected back on.
  assert.ok(close(moveHole({ hole, point: [1.3, 0, 2.4], gridMm: 0.5 }).point, [1.3, 0, 2]));
  assert.equal(holeMoveText(moveHole({ hole, point: [0.4, 0.1, 2], gridMm: 0.5 }).offset), "Not moved");
  assert.equal(moveHole({ hole, point: [NaN, 0, 2] }), null);
  // A flick is capped at the limit (10 mm at least).
  assert.ok(close(moveHole({ hole, point: [1e6, 0, 2] }).offset, [10, 0]));
});

test("nudging moves each selected hole along its own face", () => {
  let doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: {} });
  ({ doc } = addHole(doc, { point: [0, 0, 2], normal: [0, 0, 1] }));
  ({ doc } = addHole(doc, { point: [0, -5, 1], normal: [0, -1, 0] }));
  ({ doc } = addHole(doc, { point: [3, 3, 2], normal: [0, 0, 1] }));
  const [a, b, c] = doc.holes;
  const { doc: next, moved } = nudgeHoles(doc, [a.id, b.id], [0, 0.5]);
  // Up is +Y on the top face, +Z on the front wall.
  assert.deepEqual(next.holes[0].point, [0, 0.5, 2]);
  assert.deepEqual(next.holes[1].point, [0, -5, 1.5]);
  assert.equal(next.holes[2], c);
  assert.deepEqual(
    moved.map((m) => m.id),
    [a.id, b.id],
  );
  assert.deepEqual(nudgeHoles(doc, ["nope"], [1, 0]), { doc, moved: [] });
  assert.equal(nudgeHoles(doc, [a.id], [NaN, 0]).doc, doc);
});

test("outlines for the ghost, and where the selection pill hangs", () => {
  const box = onTop(rect());
  const outline = holeOutline(box);
  assert.equal(outline.length, 4);
  for (const [p] of outline) assert.ok(close([Math.abs(p[0]), Math.abs(p[1])], [10, 5]));
  const circle = holeOutline(onTop(round(10)));
  assert.equal(circle.length, 48);
  for (const [p] of circle) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 5) < 1e-9);
  assert.deepEqual(
    holeCross(box, 2).map((s) => s.map((p) => p.map((v) => v + 0))),
    [
      [
        [-1, 0, 2],
        [1, 0, 2],
      ],
      [
        [0, -1, 2],
        [0, 1, 2],
      ],
    ],
  );
  // Below the outline's bottom edge (y = -5), or the ring (5.5) where that
  // is further out, then down in the world by half the furthest reach of
  // the outline from there; a turned rectangle reaches down the face by
  // its width.
  assert.ok(close(holePillAnchor(box), [0, -5.5, 2 - 0.5 * Math.hypot(10, 10.5)]));
  assert.ok(close(holePillAnchor(onTop(rect({ spin: 90 }))), [0, -10, 2 - 0.5 * Math.hypot(5, 20)], 1e-5));
  assert.ok(close(holePillAnchor(onTop(round(10))), [0, -5.5, -3.5]));
  // On a wall the face's down is the world's: the anchor is at the ring's
  // bottom, dropped only the little a corner of the ring beside it needs
  // in the Home view — not by the radius again (it hung a radius below).
  const wall = { id: "h2", point: [0, -5, 3], normal: [0, -1, 0], spec: round(4), presetId: null };
  const [wx, wy, wz] = holePillAnchor(wall);
  assert.ok(close([wx, wy], [0, -5]));
  assert.ok(wz < 0.5 && wz > 0.5 - 0.3, `${wz}`);
  // A wide rectangle on a wall: its lower corners are 10 mm beside it.
  const wide = { ...wall, point: [0, -5, 10], spec: rect() };
  assert.ok(close(holePillAnchor(wide), [0, -5, 4.5 - (0.5 * 10 - 0.5)]));
});

// Orthographic screen-up directions of the View menu's views (the camera
// keeps +Z up; Home looks from [1, -1, 1]), and the faces each one sees.
const VIEWS = {
  home: { up: [-1, 1, 2].map((v) => v / Math.sqrt(6)), view: [-1, 1, -1].map((v) => v / Math.sqrt(3)) },
  top: { up: [0, 1, 0], view: [0, 0, -1] },
  front: { up: [0, 0, 1], view: [0, 1, 0] },
  right: { up: [0, 0, 1], view: [-1, 0, 0] },
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// What the pill has to stay below: the ring (footprint + 0.5) and the
// outline the handles stand on.
function ringAndOutline(hole) {
  const ring = holeFootprintRadius(hole.spec) + 0.5;
  const { ex, ey } = holeFrame({ ...hole, spec: round(1) });
  const out = holeOutline(hole).flat();
  for (let i = 0; i < 360; i++) {
    const t = (i * Math.PI) / 180;
    out.push(hole.point.map((c, k) => c + ring * (Math.cos(t) * ex[k] + Math.sin(t) * ey[k])));
  }
  return out;
}

test("the pill's anchor is below the hole on screen in every view that sees its face, and close below it square on", () => {
  const holes = [
    onTop(rect()),
    onTop(rect({ spin: 30 })),
    onTop(rect({ spin: 135, height: 30 })),
    onTop(round(10)),
    { id: "w1", point: [0, -21, 15], normal: [0, -1, 0], spec: round(14), presetId: null },
    { id: "w2", point: [21, 0, 15], normal: [1, 0, 0], spec: round(10), presetId: null },
    { id: "w3", point: [21, 0, 15], normal: [1, 0, 0], spec: rect({ spin: 30 }), presetId: null },
  ];
  for (const hole of holes) {
    const anchor = holePillAnchor(hole);
    const points = ringAndOutline(hole);
    for (const [name, { up, view }] of Object.entries(VIEWS)) {
      // Only the views that see the face, not edge on.
      if (dot3(hole.normal, view) > -0.2) continue;
      const gap = Math.min(...points.map((p) => dot3(p, up))) - dot3(anchor, up);
      // (Within 0.02 mm: the anchor reads the ring at 48 points, as the
      // viewer draws it, and this at 360.)
      assert.ok(gap >= -0.02, `${hole.id} ${hole.spec.kind} spin ${hole.spec.spin} in ${name}: ${gap}`);
      // Square on (the Top view of a plate, the Front or Right of a wall)
      // it hangs right under the ring: QA's wall hole hung a whole ring
      // radius (7.5 mm) lower.
      if (dot3(hole.normal, view) < -0.99 && hole.spec.kind === "cylinder")
        assert.ok(gap < 0.15 * hole.spec.diameter, `${name}: ${gap}`);
    }
  }
});

test("a move's label leaves out a part that rounds to nothing", () => {
  assert.equal(holeMoveText([0.0004, 0.83]), "0.83 mm up");
  assert.equal(holeMoveText([-0.0004, -0.0002]), "Not moved");
  assert.equal(holeMoveText([-1.371, 0.0001]), "1.371 mm left");
  assert.equal(holeMoveText([2, -0.5]), "2 mm right, 0.5 mm down");
});

test("a moved hole stays on a face: the base's, or one only the holes made, its own bore no matter", () => {
  // A round cutout on the floor of a 24 x 24 pocket (z = 2) in a plate
  // whose top is z = 4 and which ends at |x|, |y| = 21.
  const hole = { id: "h2", point: [0, 0, 2], normal: [0, 0, 1], spec: round(4), presetId: null };
  assert.equal(holeReach(hole), 2);
  assert.ok(Math.abs(holeReach(onTop(rect())) - Math.hypot(10, 5)) < 1e-9);
  const inPlate = (p) => Math.abs(p[0]) <= 21 && Math.abs(p[1]) <= 21;
  // The base without holes: only the top face, at z = 4.
  const base = (p) => inPlate(p) && p[2] === 4;
  // The mesh on screen: the top (outside the pocket) and the pocket's
  // floor, with the moving hole's bore (r 2) through it where it is.
  const inPocket = (p) => Math.abs(p[0]) <= 12 && Math.abs(p[1]) <= 12;
  const shownWith = (h) => (p) =>
    (p[2] === 4 && inPlate(p) && !inPocket(p)) ||
    (p[2] === 2 && inPocket(p) && Math.hypot(p[0] - h.point[0], p[1] - h.point[1]) > 2);
  const probes = { base, shown: shownWith(hole) };
  // A step across the floor, shorter than its radius: inside its own bore,
  // where the floor runs on past it.
  assert.equal(movedOnFace(hole, [0.5, 0, 2], probes), true);
  // Further, onto the floor proper; and off the floor, past the pocket's
  // wall.
  assert.equal(movedOnFace(hole, [5, 0, 2], probes), true);
  assert.equal(movedOnFace(hole, [13, 0, 2], probes), false);
  // A hole hanging over the floor's edge (its bore reaches x = 13, the
  // floor ends at 12): a short step on towards the wall is refused — its
  // centre would still be on the floor, but under the bore the mesh can't
  // show that, and the check errs towards the face — and one back isn't.
  const nearWall = { ...hole, point: [11, 0, 2] };
  const nearProbes = { base, shown: shownWith(nearWall) };
  assert.equal(movedOnFace(nearWall, [11.5, 0, 2], nearProbes), false);
  assert.equal(movedOnFace(nearWall, [10.5, 0, 2], nearProbes), true);
  // A hole on the top face asks the base alone, its bore no matter.
  const top = { ...hole, point: [15, 15, 4] };
  assert.equal(movedOnFace(top, [15.5, 15, 4], { base, shown: () => false }), true);
  assert.equal(movedOnFace(top, [22, 15, 4], probes), false);
  // Nothing rendered yet to ask: yes.
  assert.equal(movedOnFace(hole, [99, 0, 2], {}), true);
});
