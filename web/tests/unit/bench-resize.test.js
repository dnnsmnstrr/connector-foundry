import test from "node:test";
import assert from "node:assert/strict";

import { ROOT_ID, addChild, createAssembly } from "../../src/lib/assembly.js";
import { nodeWorldMount } from "../../src/lib/benchOrientation.js";
import {
  NO_EXTENTS,
  WORLD_FRAME,
  attachedFrame,
  attachedResizeAxes,
  ghostToWorld,
  handlesToWorld,
  toFrame,
  toWorld,
  worldBoundsOf,
  guardNote,
  guardResize,
  keepsSlots,
  mergeExtents,
  predictedExtents,
  resizeGhost,
  rootBoxFor,
  sameParams,
} from "../../src/lib/benchResize.js";
import {
  dragResize,
  handlesForBox,
  resizeAxes,
  stepResize,
  typedResize,
  viewerHandles,
} from "../../src/lib/resize.js";
import { mountOffset } from "../../src/lib/slots.js";

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

// --- Handles on attached parts ------------------------------------------------

const basicsPlate = {
  id: "basics/plate",
  anchors: ["bot", "xpos", "xneg", "ypos", "yneg"],
  defaults: { w: 42, d: 42, t: 4, r: 4 },
  resize: { x: { param: "w", min: 8 }, y: { param: "d", min: 8 }, z: { param: "t" } },
};
const goproFemale = {
  id: "gopro/female",
  defaults: { outer_w: 6, symmetric: false },
  mount_offset: { y: { param: "outer_w", offset: -3, scale: 0.5, unless: "symmetric" } },
};
const framePartsById = new Map([
  ["basics/plate", basicsPlate],
  ["gopro/female", goproFemale],
  ["bitbeam/plate", plate],
]);
const ROOT_PLATE = { w: 60, d: 40, t: 6, r: 0 };
const CHILD_PLATE = { w: 30, d: 16, t: 5, r: 0 };
const lastNode = (a) => a.nodes[a.nodes.length - 1].id;
const platedRoot = () => createAssembly("basics/plate", ROOT_PLATE);
const onRoot = (a, o) =>
  addChild(a, { parentId: ROOT_ID, partId: "basics/plate", params: CHILD_PLATE, slotName: "mount", ...o });

// Each node's own extents, as the Bench measures them: the parameters'
// sizes for a basics plate, the measured box for the GoPro female.
function extentsOf(a) {
  const own = (node) =>
    node.partId === "gopro/female"
      ? [20, 23, 20]
      : node.partId === "bitbeam/plate"
        ? [node.params.grid_x * 8, node.params.grid_y * 8, 8]
        : [node.params.w, node.params.d, node.params.t];
  return new Map([
    [ROOT_ID, own(a.root)],
    ...a.nodes.map((n) => /** @type {[string, number[]]} */ ([n.id, own(n)])),
  ]);
}

// The frame Bench.jsx builds an attached part's handles in.
function frameOf(a, id) {
  const node = a.nodes.find((n) => n.id === id);
  const placed = nodeWorldMount(a, framePartsById, extentsOf(a), id);
  assert.ok(placed, `${id} has a place`);
  return attachedFrame(placed, mountOffset(framePartsById.get(node.partId), node.params));
}

// The attached part's world bounding box in openscad-wasm renders of
// Bench-generated sources (assembly.js's compileToScad(), the part shown
// alone in its attached pose through the crop mask's show_only();
// measured 2026-10-28), against the box the handles stand on. The
// plates have square corners (r = 0), so the bounds are the box's
// corners at any spin.
const MEASURED_POSES = [
  [
    "top, spin 30, shifted",
    () => onRoot(platedRoot(), { spin: 30, shift: [3, -5] }),
    [-11.89, -17.26, 6],
    [22.09, 11.6, 11],
  ],
  ["xpos", () => onRoot(platedRoot(), { slotName: "xpos" }), [30, -8, -12], [35, 8, 18]],
  [
    "xpos, spin 30, shifted, bolted",
    () => onRoot(platedRoot(), { slotName: "xpos", spin: 30, shift: [4, 2], joint: "bolted" }),
    [38, -10.7, -16.45],
    [43, 18.16, 17.53],
  ],
  [
    "ypos, spin 90, sunk 1.5",
    () => onRoot(platedRoot(), { slotName: "ypos", spin: 90, overlap: 1.5 }),
    [-8, 21.5, -12],
    [8, 26.5, 18],
  ],
  [
    "bot, spin 45, shifted",
    () => onRoot(platedRoot(), { slotName: "bot", spin: 45, shift: [5, 3] }),
    [-17.68, -10.61, -5],
    [14.85, 21.92, 0],
  ],
  [
    "yneg of a part on xneg",
    () => {
      const a = onRoot(platedRoot(), { slotName: "xneg", spin: 20 });
      return onRoot(a, { parentId: lastNode(a), slotName: "yneg", spin: 70, shift: [2, 1] });
    },
    [-47.11, -16.45, -5.91],
    [-13.45, -3.1, 19.57],
  ],
  [
    "stacked under a part on xpos",
    () => {
      const a = onRoot(platedRoot(), { slotName: "xpos", spin: 15 });
      return onRoot(a, { parentId: lastNode(a), slotName: "bot", spin: 40 });
    },
    [35, -16.88, -12.16],
    [40, 16.88, 18.16],
  ],
  [
    "GoPro female (mount offset) on xpos, spin 30",
    () =>
      onRoot(platedRoot(), { slotName: "xpos", spin: 30, partId: "gopro/female", params: { outer_w: 10 } }),
    [30, -17.99, -13.16],
    [50, 11.93, 15.66],
  ],
  [
    "GoPro female on top, shifted",
    () => onRoot(platedRoot(), { shift: [2, 3], partId: "gopro/female", params: { outer_w: 10 } }),
    [-8, -12, 6],
    [12, 11, 26],
  ],
  [
    "BitBeam plate on ypos, spin 90",
    () =>
      onRoot(platedRoot(), {
        slotName: "ypos",
        spin: 90,
        partId: "bitbeam/plate",
        params: { grid_x: 3, grid_y: 2 },
      }),
    [-8, 20, -9],
    [8, 28, 15],
  ],
];

test("an attached part's handle box is where the renders put the part", () => {
  for (const [label, build, min, max] of MEASURED_POSES) {
    const a = build();
    const id = lastNode(a);
    const bounds = worldBoundsOf(frameOf(a, id), rootBoxFor(extentsOf(a).get(id)));
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(bounds.min[i] - min[i]) < 0.01, `${label}: min ${bounds.min} vs ${min}`);
      assert.ok(Math.abs(bounds.max[i] - max[i]) < 0.01, `${label}: max ${bounds.max} vs ${max}`);
    }
  }
});

test("the frame's +Z runs from the mating face out through the part", () => {
  const a = onRoot(platedRoot(), { slotName: "xpos" });
  const id = lastNode(a);
  const box = rootBoxFor(extentsOf(a).get(id));
  const frame = frameOf(a, id);
  const handles = handlesToWorld(
    frame,
    viewerHandles(box, resizeAxes(basicsPlate, CHILD_PLATE), CHILD_PLATE),
  );
  const height = handles.find((h) => h.id === "z+");
  // On the root's +X face (x = 30), the part's far face is 5 mm out.
  assert.deepEqual(
    height.point.map((v) => Math.round(v * 1e6) / 1e6),
    [35, 0, 3],
  );
  assert.deepEqual(
    height.dir.map((v) => Math.round(v * 1e6) / 1e6 + 0),
    [1, 0, 0],
  );
  assert.deepEqual(
    height.constraint.dir.map((v) => Math.round(v * 1e6) / 1e6 + 0),
    [1, 0, 0],
  );
  // Footprint handles stand on the mating face, their span running out
  // through the part, and a corner's plane turns with it.
  const width = handles.find((h) => h.id === "x+");
  assert.equal(Math.round(width.point[0] * 1e6) / 1e6, 30);
  assert.deepEqual(
    width.span.map((v) => Math.round(v * 1e6) / 1e6 + 0),
    [5, 0, 0],
  );
  const corner = handles.find((h) => h.kind === "corner");
  assert.deepEqual(
    corner.constraint.normal.map((v) => Math.round(v * 1e6) / 1e6 + 0),
    [1, 0, 0],
  );
});

test("a drag on an attached part's handle, through its frame, resizes like the root's", () => {
  const a = onRoot(platedRoot(), { slotName: "ypos", spin: 30 });
  const id = lastNode(a);
  const frame = frameOf(a, id);
  const box = rootBoxFor(extentsOf(a).get(id));
  const axes = resizeAxes(basicsPlate, CHILD_PLATE);
  const startParams = { ...basicsPlate.defaults, ...CHILD_PLATE };
  const local = handlesForBox(box, axes);
  for (const [id_, grow, param, expected] of [
    ["x+", 4, "w", 38],
    ["y-", 3, "d", 22],
    ["z+", 2.5, "t", 7.5],
  ]) {
    const handle = local.find((h) => h.id === id_);
    const world = handlesToWorld(frame, [handle])[0];
    // The pointer moves `grow` mm along the handle's own world direction.
    const point = world.point.map((v, i) => v + world.dir[i] * grow);
    const result = dragResize({ handle, axes, box, startParams, point: toFrame(frame, point), gridMm: 0.5 });
    assert.deepEqual(result.params, { [param]: expected }, id_);
  }
});

test("toFrame undoes toWorld; the world frame leaves handles and ghosts alone", () => {
  const a = onRoot(platedRoot(), { slotName: "xneg", spin: 33, shift: [1, 2] });
  const frame = frameOf(a, lastNode(a));
  const p = [3, -4, 5];
  assert.ok(toFrame(frame, toWorld(frame, p)).every((v, i) => Math.abs(v - p[i]) < 1e-9));
  const handles = handlesForBox(boxOf(10, 10, 10), resizeAxes(basicsPlate, CHILD_PLATE));
  assert.equal(handlesToWorld(WORLD_FRAME, handles), handles);
  const ghost = {
    segments: [
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    ],
    textPoint: [1, 0, 0],
    handlePoints: { "x+": [1, 0, 0] },
  };
  assert.equal(ghostToWorld(WORLD_FRAME, ghost), ghost);
  const moved = ghostToWorld(frame, ghost);
  assert.deepEqual(moved.textPoint, toWorld(frame, [1, 0, 0]));
  assert.deepEqual(moved.handlePoints["x+"], toWorld(frame, [1, 0, 0]));
  assert.deepEqual(moved.segments[0][0], frame.origin);
});

test("an attached part whose resize moves its mount anchor gets no handles", () => {
  assert.equal(attachedResizeAxes(basicsPlate, CHILD_PLATE).length, 3);
  assert.deepEqual(attachedResizeAxes(goproFemale, goproFemale.defaults), []);
  const widened = {
    ...goproFemale,
    resize: { x: { param: "outer_w" } },
    defaults: { outer_w: 6, symmetric: false },
  };
  assert.deepEqual(attachedResizeAxes(widened, widened.defaults), []);
  // A fixed offset doesn't move with any parameter: the part still grows
  // about its centre, which the frame places.
  const fixed = { ...basicsPlate, mount_offset: [0, 3.4] };
  assert.equal(attachedResizeAxes(fixed, CHILD_PLATE).length, 3);
  assert.deepEqual(attachedResizeAxes({ kind: "imported", resize: basicsPlate.resize }, {}), []);
});

test("the guard runs for an attached part's own children", () => {
  // A BitBeam plate on the root's side, with something on its own middle
  // slot: 3 → 4 cells would rename it, so the drag lands on 5.
  const a = onRoot(platedRoot(), {
    slotName: "xpos",
    partId: "bitbeam/plate",
    params: { grid_x: 3, grid_y: 3 },
  });
  const id = lastNode(a);
  const frame = frameOf(a, id);
  const box = rootBoxFor(extentsOf(a).get(id));
  const startParams = { ...plate.defaults, grid_x: 3, grid_y: 3 };
  const axes = attachedResizeAxes(plate, startParams);
  const handle = handlesForBox(box, axes).find((h) => h.id === "x+");
  const world = handlesToWorld(frame, [handle])[0];
  const point = world.point.map((v, i) => v + world.dir[i] * 4);
  const result = dragResize({ handle, axes, box, startParams, point: toFrame(frame, point) });
  assert.deepEqual(result.params, { grid_x: 4 });
  const out = guardResize({
    part: plate,
    axes,
    handle,
    box,
    startParams,
    occupied: new Set(["mount_0_0"]),
    result,
  });
  assert.deepEqual(out.result.params, { grid_x: 5 });
  assert.equal(guardNote(out.refused), "4 would move attached parts");
});
