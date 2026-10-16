import test from "node:test";
import assert from "node:assert/strict";

import {
  axisLetter,
  boxEdges,
  centreCross,
  dragResize,
  formatMm,
  handlesForBox,
  mirrorHandleId,
  resizeAxes,
  resizeText,
  resizeValue,
  stepResize,
  stepValue,
  typedResize,
  viewerHandles,
} from "../../src/lib/resize.js";

// Catalogue entries shaped like catalogue.yaml's, cut down to what
// resize.js reads.
const bin = {
  id: "gridfinity/bin",
  defaults: { gx: 2, gy: 1, gz: 3, lip: true },
  resize: {
    x: { param: "gx", per: 42, step: 1, max: 8 },
    y: { param: "gy", per: 42, step: 1, max: 8 },
    z: { param: "gz", per: 7, step: 1, max: 20 },
  },
};
const plate = {
  id: "basics/plate",
  defaults: { w: 40, d: 30, t: 3, r: 2 },
  minimums: { t: 1 },
  resize: { x: { param: "w" }, y: { param: "d" }, z: { param: "t" } },
};
const post = {
  id: "basics/post",
  defaults: { dia: 10, h: 20 },
  resize: { xy: { param: "dia" }, z: { param: "h" } },
};
const rail = {
  id: "extrusion2020/rail",
  defaults: { len: 100, orientation: "horizontal" },
  options: { orientation: ["horizontal", "vertical"] },
  resize: {
    x: { param: "len", when: { orientation: "horizontal" } },
    z: { param: "len", when: { orientation: "vertical" } },
  },
};

// The bin at its defaults: 2 × 1 units, 3 high (with a lip, as rendered).
const binBox = { min: [-41.75, -20.75, 0], max: [41.75, 20.75, 24.548] };
const plateBox = { min: [-20, -15, 0], max: [20, 15, 3] };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("resize axes resolve the slope, the step and the handle's bounds", () => {
  assert.deepEqual(resizeAxes(bin), [
    { axis: "x", param: "gx", per: 42, step: 1, min: 1, max: 8 },
    { axis: "y", param: "gy", per: 42, step: 1, min: 1, max: 8 },
    { axis: "z", param: "gz", per: 7, step: 1, min: 1, max: 20 },
  ]);
  // A free length: per defaults to 1, the floor is 0.1 mm, the catalogue's
  // minimum wins where there is one, and there is no ceiling.
  const [w, , t] = resizeAxes(plate);
  assert.deepEqual(w, { axis: "x", param: "w", per: 1, step: null, min: 0.1, max: Infinity });
  assert.equal(t.min, 1);
});

test("bounds combine the catalogue's limits with the entry's own, and never reach 0", () => {
  const part = {
    defaults: { cols: 3, channel: 2 },
    minimums: { cols: 1, channel: 0 },
    maximums: { cols: 12 },
    resize: { x: { param: "cols", per: 20.438, step: 1, min: 2, max: 20 }, z: { param: "channel" } },
  };
  const [cols, channel] = resizeAxes(part);
  assert.equal(cols.min, 2, "the larger floor");
  assert.equal(cols.max, 12, "the smaller ceiling");
  assert.equal(channel.min, 0.1, "a floor of 0 is no floor for a handle");
});

test("an entry applies only when its `when` matches the current parameters", () => {
  assert.deepEqual(
    resizeAxes(rail).map((a) => a.axis),
    ["x"],
  );
  assert.deepEqual(
    resizeAxes(rail, { orientation: "vertical" }).map((a) => a.axis),
    ["z"],
  );
});

test("parts without resize, or with a parameter that isn't a number, get no axes", () => {
  assert.deepEqual(resizeAxes({ defaults: { gx: 1 } }), []);
  assert.deepEqual(resizeAxes(null), []);
  assert.deepEqual(resizeAxes({ defaults: { lip: true }, resize: { z: { param: "lip" } } }), []);
  assert.deepEqual(resizeAxes({ defaults: {}, resize: { z: { param: "missing" } } }), []);
});

test("x and y make edge handles on the bottom edges, corners between them, z one on top", () => {
  const handles = handlesForBox(binBox, resizeAxes(bin));
  assert.deepEqual(
    handles.map((h) => h.id),
    ["x+", "x-", "y+", "y-", "x+y+", "x+y-", "x-y+", "x-y-", "z+"],
  );
  const byId = Object.fromEntries(handles.map((h) => [h.id, h]));
  assert.deepEqual(byId["x+"].point, [41.75, 0, 0]);
  assert.deepEqual(byId["y-"].point, [0, -20.75, 0]);
  assert.deepEqual(byId["x-y+"].point, [-41.75, 20.75, 0]);
  assert.deepEqual(byId["z+"].point, [0, 0, 24.548]);
  assert.deepEqual(byId["x-"].constraint, { type: "line", dir: [-1, 0, 0] });
  assert.deepEqual(byId["x+y+"].constraint, { type: "plane", normal: [0, 0, 1] });
  assert.ok(close(Math.hypot(...byId["x+y-"].dir), 1));
  assert.equal(byId["z+"].kind, "top");
  // One keyboard stop per axis; corners are pointer-only.
  assert.deepEqual(
    handles.filter((h) => h.tabbable).map((h) => h.id),
    ["x+", "y+", "z+"],
  );
});

test("a diameter gets four handles driving one parameter", () => {
  const handles = handlesForBox({ min: [-5, -5, 0], max: [5, 5, 20] }, resizeAxes(post));
  assert.deepEqual(
    handles.map((h) => h.id),
    ["xy:x+", "xy:x-", "xy:y+", "xy:y-", "z+"],
  );
  assert.deepEqual(
    handles.filter((h) => h.tabbable).map((h) => h.id),
    ["xy:x+", "z+"],
  );
});

test("mirror handles pair up across the centre", () => {
  assert.equal(mirrorHandleId("x+"), "x-");
  assert.equal(mirrorHandleId("y-"), "y+");
  assert.equal(mirrorHandleId("x+y-"), "x-y+");
  assert.equal(mirrorHandleId("xy:y+"), "xy:y-");
  assert.equal(mirrorHandleId("z+"), null);
});

test("a count rounds to its step", () => {
  const [gx] = resizeAxes(bin);
  // 83.5 mm wide at gx 2; asking for 110 mm is 2.63 units -> 3.
  assert.deepEqual(resizeValue(gx, 2, 83.5, 110, 0.5), { value: 3, size: 125.5, clamped: false });
  assert.deepEqual(resizeValue(gx, 2, 83.5, 100, 0.5), { value: 2, size: 83.5, clamped: false });
});

test("a free length snaps the value itself to the grid, not the change", () => {
  const [w] = resizeAxes(plate);
  // 40.3 + 0.8 = 41.1 -> 41 on a 1 mm grid, not 41.3.
  assert.equal(resizeValue(w, 40.3, 40.3, 41.1, 1).value, 41);
  assert.equal(resizeValue(w, 40.3, 40.3, 40.8, 0.25).value, 40.75);
  assert.equal(resizeValue(w, 40, 40, 40.37, 0.1).value, 40.4);
  // Off: hundredths.
  assert.equal(resizeValue(w, 40, 40, 41.23456, 0).value, 41.23);
});

test("a free parameter with another slope snaps the size change to the grid", () => {
  const axis = { axis: "x", param: "margin", per: 2, step: null, min: 0.05, max: Infinity };
  // +2.3 mm of size -> +2.5 on a 0.5 grid -> margin +1.25.
  const r = resizeValue(axis, 3, 20, 22.3, 0.5);
  assert.equal(r.value, 4.25);
  assert.equal(r.size, 22.5);
});

test("values clamp to the handle's bounds, but a start value past them is no jump", () => {
  const [gx] = resizeAxes(bin);
  assert.deepEqual(resizeValue(gx, 2, 83.5, 1000, 0), { value: 8, size: 335.5, clamped: true });
  assert.deepEqual(resizeValue(gx, 2, 83.5, 1, 0), { value: 1, size: 41.5, clamped: true });
  // gx 12 typed in the sidebar (over the handle max of 8): a small drag
  // out stays at 12; a drag in still works.
  assert.equal(resizeValue(gx, 12, 503.5, 520, 0).value, 12);
  assert.equal(resizeValue(gx, 12, 503.5, 450, 0).value, 11);
});

test("non-finite input, or no change at all, keeps the start", () => {
  const [gx] = resizeAxes(bin);
  assert.deepEqual(resizeValue(gx, 2, 83.5, NaN, 0), { value: 2, size: 83.5, clamped: false });
  assert.deepEqual(resizeValue(gx, 1.5, 62.5, 62.5, 0), { value: 1.5, size: 62.5, clamped: false });
});

test("a keyboard step moves a count by its step and a length by the grid", () => {
  const [gx] = resizeAxes(bin);
  const [w] = resizeAxes(plate);
  assert.equal(stepValue(gx, 2, 1, 0.5), 3);
  assert.equal(stepValue(gx, 2, -3, 0.5), 1, "clamped at the floor");
  assert.equal(stepValue(gx, 8, 1, 0.5), 8, "and the ceiling");
  assert.equal(stepValue(w, 40, 1, 0.5), 40.5);
  assert.equal(stepValue(w, 40, 10, 1), 50);
  // An off-grid length lands on the grid first, in the direction pressed.
  assert.equal(stepValue(w, 40.3, 1, 1), 41);
  assert.equal(stepValue(w, 40.3, -1, 1), 40);
  assert.equal(stepValue(w, 40.3, 1, 0.1), 40.4);
  // Grid off: 0.1 mm.
  assert.equal(stepValue(w, 40, 1, 0), 40.1);
  // Another slope: the step is in outside size, converted through `per`.
  const axis = { axis: "x", param: "margin", per: 2, step: null, min: 0.05, max: Infinity };
  assert.equal(stepValue(axis, 3, 1, 1), 3.5);
});

test("dragging an X edge grows the part on both sides by twice the travel", () => {
  const axes = resizeAxes(plate);
  const handle = handlesForBox(plateBox, axes).find((h) => h.id === "x+");
  // Pointer 5.2 mm out from the +X edge: 40 + 10.4 = 50.4 -> 50.5 (grid 0.5).
  const r = dragResize({
    handle,
    axes,
    box: plateBox,
    startParams: plate.defaults,
    point: [25.2, 0, 0],
    gridMm: 0.5,
  });
  assert.deepEqual(r.params, { w: 50.5 });
  assert.deepEqual(r.values, { w: 50.5 });
  assert.deepEqual(r.box, { min: [-25.25, -15, 0], max: [25.25, 15, 3] });
  assert.deepEqual(r.sizes, { x: 50.5, y: 30, z: 3 });
  assert.equal(r.clamped, false);
  // The -X handle dragged outward does the same.
  const minus = handlesForBox(plateBox, axes).find((h) => h.id === "x-");
  const r2 = dragResize({
    handle: minus,
    axes,
    box: plateBox,
    startParams: plate.defaults,
    point: [-25.2, 0, 0],
    gridMm: 0.5,
  });
  assert.deepEqual(r2.params, { w: 50.5 });
});

test("a corner drives both footprint parameters; the height grows up from the bottom", () => {
  const axes = resizeAxes(bin);
  const handles = handlesForBox(binBox, axes);
  const corner = handles.find((h) => h.id === "x-y+");
  // Out 21 mm in X (-X side) and 21 mm in Y: +42 mm each -> +1 unit each.
  const r = dragResize({
    handle: corner,
    axes,
    box: binBox,
    startParams: bin.defaults,
    point: [-62.75, 41.75, 0],
    gridMm: 0.5,
  });
  assert.deepEqual(r.params, { gx: 3, gy: 2 });
  assert.ok(close(r.sizes.x, 125.5) && close(r.sizes.y, 83.5));

  const top = handles.find((h) => h.id === "z+");
  const up = dragResize({
    handle: top,
    axes,
    box: binBox,
    startParams: bin.defaults,
    point: [0, 0, 24.548 + 15],
    gridMm: 0.5,
  });
  assert.deepEqual(up.params, { gz: 5 });
  assert.equal(up.box.min[2], 0, "the bottom stays");
  assert.ok(close(up.box.max[2], 24.548 + 14));
  assert.equal(up.box.min[0], binBox.min[0], "the footprint stays");
});

test("a diameter handle grows X and Y together", () => {
  const axes = resizeAxes(post);
  const box = { min: [-5, -5, 0], max: [5, 5, 20] };
  const handle = handlesForBox(box, axes).find((h) => h.id === "xy:y-");
  const r = dragResize({ handle, axes, box, startParams: post.defaults, point: [0, -7, 0], gridMm: 1 });
  assert.deepEqual(r.params, { dia: 14 });
  assert.deepEqual(r.box, { min: [-7, -7, 0], max: [7, 7, 20] });
});

test("one flick can't ask for more than about four times the start size", () => {
  const axes = resizeAxes(plate);
  const handle = handlesForBox(plateBox, axes).find((h) => h.id === "x+");
  const r = dragResize({
    handle,
    axes,
    box: plateBox,
    startParams: plate.defaults,
    point: [1e6, 0, 0],
    gridMm: 1,
  });
  // Travel capped at 4 × 40 = 160 mm: 40 + 320 = 360.
  assert.equal(r.params.w, 360);
});

test("a drag with bad input, or a handle the axes don't drive, gives null", () => {
  const axes = resizeAxes(plate);
  const handle = handlesForBox(plateBox, axes).find((h) => h.id === "x+");
  const base = { handle, axes, box: plateBox, startParams: plate.defaults, gridMm: 1 };
  assert.equal(dragResize({ ...base, point: [NaN, 0, 0] }), null);
  assert.equal(
    dragResize({ ...base, point: [30, 0, 0], box: { min: [0, 0, 0], max: [Infinity, 1, 1] } }),
    null,
  );
  assert.equal(dragResize({ ...base, point: [30, 0, 0], axes: [] }), null);
  assert.equal(dragResize({ ...base, point: [30, 0, 0], startParams: { w: "40" } }), null);
});

test("the predicted box stays centred where the start box was", () => {
  const axes = resizeAxes(plate);
  const off = { min: [10, 20, 5], max: [50, 50, 8] };
  const handle = handlesForBox(off, axes).find((h) => h.id === "y+");
  const r = dragResize({
    handle,
    axes,
    box: off,
    startParams: plate.defaults,
    point: [30, 55, 5],
    gridMm: 1,
  });
  assert.deepEqual(r.params, { d: 40 });
  assert.deepEqual(r.box, { min: [10, 15, 5], max: [50, 55, 8] });
});

test("a typed size isn't snapped to the grid, but a count still rounds", () => {
  const axes = resizeAxes(plate);
  const handle = handlesForBox(plateBox, axes).find((h) => h.id === "x+");
  const r = typedResize({ handle, axes, box: plateBox, startParams: plate.defaults, mm: 52.37 });
  assert.deepEqual(r.params, { w: 52.37 });
  const binAxes = resizeAxes(bin);
  const top = handlesForBox(binBox, binAxes).find((h) => h.id === "z+");
  const h = typedResize({ handle: top, axes: binAxes, box: binBox, startParams: bin.defaults, mm: 40 });
  assert.deepEqual(h.params, { gz: 5 });
  assert.equal(
    typedResize({ handle: top, axes: binAxes, box: binBox, startParams: bin.defaults, mm: NaN }),
    null,
  );
});

test("a keyboard step through stepResize predicts the box too, and says when a bound stopped it", () => {
  const axes = resizeAxes(bin);
  const handle = handlesForBox(binBox, axes).find((h) => h.id === "x+");
  const r = stepResize({ handle, axes, box: binBox, startParams: bin.defaults, steps: 1, gridMm: 0.5 });
  assert.deepEqual(r.params, { gx: 3 });
  assert.ok(close(r.sizes.x, 125.5));
  assert.equal(r.clamped, false);
  const stopped = stepResize({
    handle,
    axes,
    box: binBox,
    startParams: { ...bin.defaults, gx: 8 },
    steps: 1,
    gridMm: 0.5,
  });
  assert.deepEqual(stopped.params, {});
  assert.equal(stopped.clamped, true);
});

test("the drag label says the size, the count and how far each side moved", () => {
  const axes = resizeAxes(bin);
  const handles = handlesForBox(binBox, axes);
  const x = handles.find((h) => h.id === "x+");
  const grow = (point, handle = x, startParams = bin.defaults) =>
    dragResize({ handle, axes, box: binBox, startParams, point, gridMm: 0.5 });
  assert.equal(resizeText(x, axes, binBox, grow([62.75, 0, 0])), "W 125.5 mm · gx 3 (+21 each side)");
  assert.equal(resizeText(x, axes, binBox, grow([41.75, 0, 0])), "W 83.5 mm · gx 2");
  assert.equal(resizeText(x, axes, binBox, grow([1000, 0, 0])), "W 335.5 mm · gx 8 (+126 each side) · max");
  const z = handles.find((h) => h.id === "z+");
  assert.equal(resizeText(z, axes, binBox, grow([0, 0, 24.548 + 7], z)), "H 31.548 mm · gz 4 (+7)");
  const corner = handles.find((h) => h.id === "x+y+");
  assert.equal(
    resizeText(corner, axes, binBox, grow([62.75, 20.75, 0], corner)),
    "W 125.5 mm · gx 3 (+21 each side), D 41.5 mm · gy 1",
  );

  const plateAxes = resizeAxes(plate);
  const w = handlesForBox(plateBox, plateAxes).find((h) => h.id === "x-");
  const shrink = dragResize({
    handle: w,
    axes: plateAxes,
    box: plateBox,
    startParams: plate.defaults,
    point: [-14, 0, 0],
    gridMm: 1,
  });
  assert.equal(resizeText(w, plateAxes, plateBox, shrink), "W 28 mm (−6 each side)");
});

test("viewer handles carry the slider semantics and the editor's prefill", () => {
  const axes = resizeAxes(bin);
  const handles = viewerHandles(binBox, axes, bin.defaults);
  const x = handles.find((h) => h.id === "x+");
  assert.equal(x.label, "Width (gx)");
  assert.equal(x.value, 2);
  assert.equal(x.valueText, "83.5 mm · gx 2");
  assert.equal(x.min, 1);
  assert.equal(x.max, 8);
  assert.equal(x.editable, true);
  assert.equal(x.editValue, 83.5);
  assert.equal(x.editLabel, "Width (mm)");
  assert.equal(x.tabbable, true);
  const corner = handles.find((h) => h.id === "x+y+");
  assert.equal(corner.editable, false);
  assert.equal(corner.label, "Width and depth (gx, gy)");
  const w = viewerHandles(plateBox, resizeAxes(plate), plate.defaults).find((h) => h.id === "x+");
  assert.equal(w.valueText, "40 mm");
  assert.equal(w.max, undefined, "no ceiling, no aria-valuemax");
  // A footprint handle's side of the box rises the box's height from its
  // point (the viewer keeps the grab target clear of all of it); the
  // height handle has no side to clear.
  assert.deepEqual(x.span, [0, 0, 24.548]);
  assert.deepEqual(corner.span, [0, 0, 24.548]);
  assert.equal(handles.find((h) => h.id === "z+").span, undefined);
  const flat = viewerHandles({ min: [-5, -5, 0], max: [5, 5, 0] }, resizeAxes(plate), plate.defaults);
  assert.equal(flat.find((h) => h.id === "x+").span, undefined, "a flat box has no side");
});

test("a value set past a handle bound in the sidebar widens the slider's range to include it", () => {
  const axes = resizeAxes(bin);
  const wide = { min: [-251.75, -20.75, 0], max: [251.75, 20.75, 24.548] };
  const x = viewerHandles(wide, axes, { ...bin.defaults, gx: 12 }).find((h) => h.id === "x+");
  assert.equal(x.value, 12);
  assert.equal(x.min, 1);
  assert.equal(x.max, 12, "aria-valuenow never sits above aria-valuemax");
});

test("a typed diameter sets the one parameter and grows X and Y together", () => {
  const axes = resizeAxes(post);
  const box = { min: [-5, -5, 0], max: [5, 5, 20] };
  const handle = handlesForBox(box, axes).find((h) => h.id === "xy:x+");
  const r = typedResize({ handle, axes, box, startParams: post.defaults, mm: 16 });
  assert.deepEqual(r.params, { dia: 16 });
  assert.deepEqual(r.sizes, { x: 16, y: 16, z: 20 });
  assert.equal(resizeText(handle, axes, box, r), "⌀ 16 mm (+3 each side)");
});

test("the ghost: a box's 12 edges and a cross on its footprint", () => {
  const edges = boxEdges(plateBox);
  assert.equal(edges.length, 12);
  for (const [a, b] of edges) {
    const differing = [0, 1, 2].filter((i) => a[i] !== b[i]);
    assert.equal(differing.length, 1, "every edge runs along one axis");
  }
  assert.deepEqual(centreCross(plateBox, 10), [
    [
      [-5, 0, 0],
      [5, 0, 0],
    ],
    [
      [0, -5, 0],
      [0, 5, 0],
    ],
  ]);
});

test("axis letters follow the header's W × H × D, and mm format without float tails", () => {
  assert.deepEqual(["x", "y", "z", "xy"].map(axisLetter), ["W", "D", "H", "⌀"]);
  assert.equal(formatMm(39.9999999997), "40");
  assert.equal(formatMm(0.125), "0.125");
  assert.equal(formatMm(1.23456), "1.235");
});
