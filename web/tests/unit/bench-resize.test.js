import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_EXTENTS,
  guardNote,
  guardResize,
  keepsSlots,
  mergeExtents,
  predictedExtents,
  resizeGhost,
  rootBoxFor,
  sameParams,
} from "../../src/lib/benchResize.js";
import { dragResize, handlesForBox, resizeAxes, stepResize, typedResize } from "../../src/lib/resize.js";

// Catalogue entries shaped like catalogue.yaml's, cut down to what
// slots.js and resize.js read.
const board = {
  id: "opengrid/board",
  slots: { pitch: 28, count_params: ["cells_x", "cells_y"] },
  defaults: { cells_x: 2, cells_y: 2, variant: "full" },
  resize: {
    x: { param: "cells_x", per: 28, step: 1, max: 6 },
    y: { param: "cells_y", per: 28, step: 1, max: 6 },
  },
};
const base = {
  id: "gridfinity/base",
  slots: { pitch: 14 },
  defaults: { gx: 2, gy: 1 },
  resize: {
    x: { param: "gx", per: 42, step: 1, max: 8 },
    y: { param: "gy", per: 42, step: 1, max: 8 },
  },
};
const plate = {
  id: "bitbeam/plate",
  slots: { pitch: 8, count_params: ["grid_x", "grid_y"] },
  side_slots: {
    pitch: 8,
    faces: [
      { name: "xpos", enabled_param: "side_holes", count_param: "grid_y" },
      { name: "xneg", enabled_param: "side_holes", count_param: "grid_y" },
      { name: "ypos", enabled_param: "side_holes", count_param: "grid_x" },
      { name: "yneg", enabled_param: "side_holes", count_param: "grid_x" },
    ],
  },
  anchors: ["bot", "xpos", "xneg", "ypos", "yneg"],
  defaults: { grid_x: 3, grid_y: 3, height: 1, side_holes: true },
  resize: {
    x: { param: "grid_x", per: 8, step: 1, max: 10 },
    y: { param: "grid_y", per: 8, step: 1, max: 10 },
    z: { param: "height", per: 8, step: 1, max: 8 },
  },
};
const rail = {
  id: "extrusion2020/rail",
  slots: { pitch: 20 },
  anchors: ["bot", "xpos", "xneg"],
  defaults: { len: 100, orientation: "horizontal" },
  resize: { x: { param: "len", when: { orientation: "horizontal" } } },
};

const boxOf = (x, y, z) => rootBoxFor([x, y, z]);

// One resize gesture on `part`, guarded: `make(args)` is one of
// resize.js's dragResize/stepResize/typedResize.
function gesture(part, params, box, handleId, occupied, make, extra) {
  const startParams = { ...part.defaults, ...params };
  const axes = resizeAxes(part, startParams);
  const handle = handlesForBox(box, axes).find((h) => h.id === handleId);
  const result = make({ handle, axes, box, startParams, ...extra });
  return guardResize({
    part,
    axes,
    handle,
    box,
    startParams,
    occupied: new Set(occupied),
    result,
    gridMm: extra.gridMm ?? 0,
  });
}
const step = (part, params, box, handleId, occupied, steps) =>
  gesture(part, params, box, handleId, occupied, stepResize, { steps });

test("a count grid with parts on it steps by two, keeping their slots' parity", () => {
  const { result, refused } = step(board, {}, boxOf(56, 56, 7), "x+", ["mount_0.5_0.5"], 1);
  assert.deepEqual(result.params, { cells_x: 4 });
  assert.equal(result.values.cells_x, 4);
  assert.deepEqual(result.box, { min: [-56, -28, 0], max: [56, 28, 7] });
  assert.deepEqual(refused, [{ param: "cells_x", value: 3, count: true }]);
  assert.equal(guardNote(refused), "3 would move attached parts");
});

test("a shrink that would drop a slot falls back toward the start, never past it", () => {
  // 2 → 1: nothing below is allowed, so it stays at 2.
  let guarded = step(board, {}, boxOf(56, 56, 7), "x-", ["mount_0.5_0.5"], -1);
  assert.deepEqual(guarded.result.params, {});
  assert.equal(guarded.result.values.cells_x, 2);
  assert.deepEqual(guarded.result.box, boxOf(56, 56, 7));
  assert.equal(guardNote(guarded.refused), "1 would move attached parts");

  // 4 → 1 with a part on an inner slot: back up to 2, the nearest that keeps it.
  const startBox = boxOf(112, 56, 7);
  guarded = step(board, { cells_x: 4 }, startBox, "x-", ["mount_0.5_0.5"], -3);
  assert.deepEqual(guarded.result.params, { cells_x: 2 });

  // 4 → 3 with a part on an outer slot: 2 and 1 lose it too, so it stays.
  guarded = step(board, { cells_x: 4 }, startBox, "x-", ["mount_1.5_0.5"], -1);
  assert.deepEqual(guarded.result.params, {});
  assert.deepEqual(guarded.result.box, startBox);
});

test("the search ahead stops at the handle's bound", () => {
  // 5 → 6 renames every slot and 7 is past max 6: it stays at 5.
  const guarded = step(board, { cells_x: 5 }, boxOf(140, 56, 7), "x+", ["mount_2_0.5"], 1);
  assert.deepEqual(guarded.result.params, {});
  assert.equal(guarded.refused[0].value, 6);
});

test("nothing attached, or nothing lost: the result goes through as it was", () => {
  const startParams = { ...board.defaults };
  const axes = resizeAxes(board, startParams);
  const box = boxOf(56, 56, 7);
  const handle = handlesForBox(box, axes).find((h) => h.id === "x+");
  const result = stepResize({ handle, axes, box, startParams, steps: 1 });
  const free = guardResize({ part: board, axes, handle, box, startParams, occupied: new Set(), result });
  assert.equal(free.result, result);
  assert.deepEqual(free.refused, []);
  // 2 → 4 keeps ±0.5.
  const two = stepResize({ handle, axes, box, startParams, steps: 2 });
  const kept = guardResize({
    part: board,
    axes,
    handle,
    box,
    startParams,
    occupied: new Set(["mount_-0.5_0.5"]),
    result: two,
  });
  assert.equal(kept.result, two);
  assert.equal(guardNote(kept.refused), null);
  assert.deepEqual(
    guardResize({ part: board, axes, handle, box, startParams, occupied: new Set(["x"]), result: null }),
    {
      result: null,
      refused: [],
    },
  );
});

test("a start that already misses an occupied slot lets the value through", () => {
  // Shrunk in the sidebar below the part's slot: the render error shows,
  // and the guard can't make it right — so it doesn't stand in the way.
  const { result, refused } = step(board, {}, boxOf(56, 56, 7), "x+", ["mount_1.5_0.5"], 1);
  assert.deepEqual(result.params, { cells_x: 3 });
  assert.deepEqual(refused, []);
});

test("a Gridfinity base's slots follow its measured size", () => {
  // gx 2 measures 83.5 mm: five slots across (−2…2). gx 1, 41.5 mm, has three.
  const startBox = boxOf(83.5, 41.5, 5);
  let guarded = step(base, {}, startBox, "x-", ["mount_2_0"], -1);
  assert.deepEqual(guarded.result.params, {});
  guarded = step(base, {}, startBox, "x-", ["mount_1_0"], -1);
  assert.deepEqual(guarded.result.params, { gx: 1 });
  // Growing only adds slots.
  guarded = step(base, {}, startBox, "x+", ["mount_2_0"], 1);
  assert.deepEqual(guarded.result.params, { gx: 3 });
});

test("side rows keep their names too, along their own axis", () => {
  // xpos runs along Y and counts grid_y: 3 → 4 renames it, so 5.
  let guarded = step(plate, {}, boxOf(24, 24, 8), "y+", ["xpos_0"], 1);
  assert.deepEqual(guarded.result.params, { grid_y: 5 });
  // grid_x doesn't touch the xpos row.
  guarded = step(plate, {}, boxOf(24, 24, 8), "x+", ["xpos_0"], 1);
  assert.deepEqual(guarded.result.params, { grid_x: 4 });
  assert.deepEqual(guarded.refused, []);
  // The height renames nothing.
  guarded = step(plate, {}, boxOf(24, 24, 8), "z+", ["xpos_0", "mount_0_0"], 1);
  assert.deepEqual(guarded.result.params, { height: 2 });
});

test("a corner settles each of its two counts", () => {
  const box = boxOf(56, 56, 7);
  const startParams = { ...board.defaults };
  const axes = resizeAxes(board, startParams);
  const handle = handlesForBox(box, axes).find((h) => h.id === "x+y+");
  // Dragged out by about half a cell on each side: 3 × 3 asked for.
  const result = dragResize({ handle, axes, box, startParams, point: [42, 42, 0] });
  assert.deepEqual(result.params, { cells_x: 3, cells_y: 3 });
  const guarded = guardResize({
    part: board,
    axes,
    handle,
    box,
    startParams,
    occupied: new Set(["mount_0.5_-0.5"]),
    result,
  });
  assert.deepEqual(guarded.result.params, { cells_x: 4, cells_y: 4 });
  assert.deepEqual(guarded.result.sizes, { x: 112, y: 112, z: 7 });
  assert.equal(guardNote(guarded.refused), "cells_x 3 and cells_y 3 would move attached parts");
});

test("a free length that drives a measured grid finds the edge it may shrink to", () => {
  // 100 mm of rail has five slots (nearest odd of 100 / 20); below 80 mm
  // it has three.
  const box = boxOf(100, 20, 20);
  const occupied = ["mount_2_0"];
  const drag = (gridMm) => gesture(rail, {}, box, "x+", occupied, dragResize, { point: [35, 0, 0], gridMm });
  // On the 0.5 mm grid it walks back; with the grid off (0.01 mm steps)
  // it bisects. Either way: 80 mm, the smallest that keeps mount_2_0.
  for (const gridMm of [0.5, 0]) {
    const { result, refused } = drag(gridMm);
    assert.deepEqual(result.params, { len: 80 }, `grid ${gridMm}`);
    assert.deepEqual(result.sizes, { x: 80, y: 20, z: 20 });
    assert.equal(guardNote(refused), "len 70 would move attached parts");
  }
  // A typed size is guarded the same way.
  const typed = gesture(rail, {}, box, "x+", occupied, typedResize, { mm: 61 });
  assert.deepEqual(typed.result.params, { len: 80 });
});

test("keepsSlots and predictedExtents", () => {
  assert.equal(keepsSlots(board, { ...board.defaults }, [56, 56, 7], new Set()), true);
  assert.equal(keepsSlots(board, { ...board.defaults }, [56, 56, 7], new Set(["mount_0.5_0.5"])), true);
  assert.equal(
    keepsSlots(board, { ...board.defaults, cells_x: 3 }, [84, 56, 7], new Set(["mount_0.5_0.5"])),
    false,
  );
  const post = { defaults: { dia: 10, h: 20 }, resize: { xy: { param: "dia" }, z: { param: "h" } } };
  const axes = resizeAxes(post, post.defaults);
  assert.deepEqual(predictedExtents([10, 10, 20], axes, post.defaults, { dia: 12.5 }), [12.5, 12.5, 20]);
  assert.deepEqual(predictedExtents([10, 10, 20], axes, post.defaults, { h: 25 }), [10, 10, 25]);
});

test("mergeExtents keeps the old maps while nothing measured differently", () => {
  const params = { w: 40 };
  const first = mergeExtents(NO_EXTENTS, [["root", [40, 40, 4], params]]);
  assert.notEqual(first, NO_EXTENTS);
  assert.deepEqual([...first.extents], [["root", [40, 40, 4]]]);
  assert.equal(first.params.get("root"), params);
  // A new but equal measurement for equal parameters (an edit elsewhere).
  assert.equal(mergeExtents(first, [["root", [40, 40, 4], { w: 40 }]]), first);
  // Different size, different parameters, another node, a node gone.
  assert.notEqual(mergeExtents(first, [["root", [41, 40, 4], params]]), first);
  assert.notEqual(mergeExtents(first, [["root", [40, 40, 4], { w: 41 }]]), first);
  assert.notEqual(
    mergeExtents(first, [
      ["root", [40, 40, 4], params],
      ["c1", [5, 5, 5], {}],
    ]),
    first,
  );
  assert.equal(mergeExtents(NO_EXTENTS, []), NO_EXTENTS);
  assert.notEqual(mergeExtents(first, []), first);
});

test("sameParams compares values, not objects", () => {
  assert.equal(sameParams({ a: 1, b: "x" }, { b: "x", a: 1 }), true);
  assert.equal(sameParams({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameParams({ a: 1, b: undefined }, { a: 1, c: undefined }), false);
  assert.equal(sameParams({ a: true }, { a: 1 }), false);
  assert.equal(sameParams(null, {}), false);
  assert.equal(sameParams(null, null), true);
});

test("resizeGhost: the outline, with the centre cross for a footprint handle", () => {
  const axes = resizeAxes(plate, plate.defaults);
  const box = boxOf(24, 24, 8);
  const [x, , , , , , , , z] = handlesForBox(box, axes);
  assert.equal(x.id, "x+");
  assert.equal(z.id, "z+");
  const footprint = resizeGhost(x, axes, box);
  assert.equal(footprint.segments.length, 14);
  assert.deepEqual(footprint.textPoint, [12, 0, 0]);
  const height = resizeGhost(z, axes, box);
  assert.equal(height.segments.length, 12);
  assert.deepEqual(height.textPoint, [0, 0, 8]);
});
