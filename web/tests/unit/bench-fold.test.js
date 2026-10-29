import test from "node:test";
import assert from "node:assert/strict";

import {
  ROOT_ID,
  addChild,
  compileToScad,
  createAssembly,
  removeChild,
  setFold,
} from "../../src/lib/assembly.js";
import { bodyTagOf, foldPlan, foldSpec } from "../../src/lib/benchFold.js";
import { checkBenchConfig, hydrateBenchConfig, serializeBenchConfig } from "../../src/lib/benchConfig.js";

// The catalogue's openConnect entry, as far as folding reads it.
const OPENCONNECT = {
  id: "opengrid/openconnect",
  name: "openConnect snap",
  file: "parts/opengrid/openconnect.scad",
  module: "og_openconnect",
  defaults: { variant: "full", body: "directional", layout: "upright" },
  fold: {
    param: "body",
    cut_y: { directional: -1.905, symmetric: -1.705, screw: -2.155, none: -5.305 },
    toward: { directional: -1, symmetric: -1, screw: -1, none: 1 },
  },
};
const PLATE = { id: "basics/plate", name: "Plate", file: "parts/basics/plate.scad", module: "basic_plate" };
const catalogue = new Map([
  [PLATE.id, PLATE],
  [OPENCONNECT.id, OPENCONNECT],
]);

// A binary STL of axis-aligned boxes, each [[x0, y0, z0], [x1, y1, z1]]:
// twelve triangles apiece (normals left zero — foldPlan() reads only
// the vertices).
function boxesStl(boxes) {
  const tris = boxes.flatMap(([[x0, y0, z0], [x1, y1, z1]]) => {
    const p = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    const faces = [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
    ];
    return faces.flatMap(([a, b, c, d]) => [
      [p(a), p(b), p(c)],
      [p(a), p(c), p(d)],
    ]);
  });
  const buffer = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((tri, i) => tri.flat().forEach((c, k) => view.setFloat32(84 + i * 50 + 12 + 4 * k, c, true)));
  return buffer;
}

const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const apply = (m, [x, y, z]) => m.slice(0, 3).map((r) => r[0] * x + r[1] * y + r[2] * z + r[3]);

test("foldSpec reads the cut and direction for the part's own parameter value", () => {
  assert.deepEqual(foldSpec(OPENCONNECT, {}), { cutY: -1.905, toward: -1 });
  assert.deepEqual(foldSpec(OPENCONNECT, { body: "none" }), { cutY: -5.305, toward: 1 });
  assert.equal(foldSpec(OPENCONNECT, { body: "made-up" }), null);
  assert.equal(foldSpec(PLATE, {}), null);
  assert.equal(foldSpec({ ...OPENCONNECT, kind: "imported" }, {}), null);
  assert.equal(foldSpec(undefined), null);
});

test("bodyTagOf walks fused joints up to the body's own start", () => {
  let a = createAssembly(PLATE.id, {});
  a = addChild(a, { parentId: ROOT_ID, partId: PLATE.id, params: {}, slotName: "mount" });
  const fused = a.nodes[0].id;
  a = addChild(a, { parentId: fused, partId: OPENCONNECT.id, params: {}, slotName: "mount" });
  const head = a.nodes[1].id;
  a = addChild(a, { parentId: ROOT_ID, partId: PLATE.id, params: {}, slotName: "bot", joint: "bolted" });
  const bolted = a.nodes[2].id;
  assert.equal(bodyTagOf(a, head), ROOT_ID);
  assert.equal(bodyTagOf(a, ROOT_ID), ROOT_ID);
  assert.equal(bodyTagOf(a, bolted), bolted);
});

test("foldPlan poses the body with the cut on y = 0 and its far end on z = 0", () => {
  // A 10 mm cube whose head frame sits at its centre: the cut at y = 4.
  const stl = boxesStl([
    [
      [0, 0, 0],
      [10, 10, 10],
    ],
  ]);
  const frame = { rotation: IDENTITY, centre: [5, 5, 5] };
  const plan = foldPlan({ stl, frame, spec: { cutY: -1, toward: -1 }, mode: "folded" });
  assert.equal(plan.split, false);
  assert.deepEqual(apply(plan.matrix, [0, 4, 0]), [-5, 0, 0]);
  assert.deepEqual(apply(plan.matrix, [10, 10, 10]), [5, 6, 10]);

  // The head frame upside down (the body runs up its z from the head):
  // the far end is now the cube's top, and X turns with Z.
  const up = foldPlan({ stl, frame, spec: { cutY: -1, toward: 1 }, mode: "folded" });
  assert.deepEqual(apply(up.matrix, [10, 4, 10]), [-5, 0, 0]);
  assert.deepEqual(apply(up.matrix, [0, 4, 0]), [5, 0, 10]);
});

test("foldPlan follows the head's rotation", () => {
  // The head turned a quarter about X: its +Y is world +Z, its +Z world -Y.
  const rotation = [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ];
  const stl = boxesStl([
    [
      [0, 0, 0],
      [10, 10, 10],
    ],
  ]);
  const plan = foldPlan({
    stl,
    frame: { rotation, centre: [5, 5, 5] },
    spec: { cutY: 0, toward: -1 },
    mode: "split",
  });
  // The cut is world z = 5; the far end (lowest along the head's -Z,
  // world +Y) is the cube's y = 10 face.
  assert.deepEqual(apply(plan.matrix, [0, 10, 5]), [-5, 0, 0]);
  assert.deepEqual(apply(plan.matrix, [0, 0, 10]), [-5, 5, 10]);
  assert.equal(plan.split, true);
});

test("a fold needs the cut face to reach the far end; a split doesn't", () => {
  // A cube, and a bar standing past its far end (z < 0) only in front
  // of the cut (y > 4): the cut face stops at z = 0, short of z = -5.
  const stl = boxesStl([
    [
      [0, 0, 0],
      [10, 10, 10],
    ],
    [
      [0, 6, -5],
      [10, 10, 0],
    ],
  ]);
  const frame = { rotation: IDENTITY, centre: [5, 5, 5] };
  const spec = { cutY: -1, toward: -1 };
  assert.match(foldPlan({ stl, frame, spec, mode: "folded" }).error, /can't fold.*Split instead/);
  const split = foldPlan({ stl, frame, spec, mode: "split" });
  assert.equal(split.split, true);
  assert.deepEqual(apply(split.matrix, [0, 6, -5]), [-5, 2, 0]);
});

test("nothing behind the cut lays the body on its side, with no hinge", () => {
  const stl = boxesStl([
    [
      [0, 0, 0],
      [10, 10, 10],
    ],
  ]);
  const plan = foldPlan({
    stl,
    frame: { rotation: IDENTITY, centre: [5, 5, 5] },
    spec: { cutY: -6, toward: -1 },
    mode: "folded",
  });
  assert.equal(plan.split, true);
});

test("foldPlan refuses what isn't a binary STL", () => {
  const frame = { rotation: IDENTITY, centre: [0, 0, 0] };
  const spec = { cutY: 0, toward: -1 };
  assert.throws(() => foldPlan({ stl: new ArrayBuffer(90), frame, spec, mode: "split" }), /binary STL/);
});

test("setFold keeps one fold, on a node that exists, and removing it clears it", () => {
  let a = createAssembly(PLATE.id, {});
  a = addChild(a, { parentId: ROOT_ID, partId: OPENCONNECT.id, params: {}, slotName: "mount" });
  const head = a.nodes[0].id;
  const folded = setFold(a, head, "folded");
  assert.deepEqual(folded.fold, { id: head, mode: "folded" });
  assert.equal(setFold(folded, head, "folded"), folded);
  assert.equal(setFold(a, head, "sideways"), a);
  assert.equal(setFold(a, "c-missing", "folded"), a);
  // Clearing another node's fold leaves this one; clearing its own drops it.
  assert.equal(setFold(folded, ROOT_ID, null), folded);
  assert.equal(setFold(folded, head, null).fold, undefined);
  assert.equal(removeChild(folded, head).fold, undefined);
});

test("compileToScad wraps the tree in fold_print() only when given a layout", () => {
  let a = createAssembly(PLATE.id, {});
  a = addChild(a, { parentId: ROOT_ID, partId: OPENCONNECT.id, params: { body: "none" }, slotName: "mount" });
  a = setFold(a, a.nodes[0].id, "folded");
  const plain = compileToScad(a, catalogue);
  assert.doesNotMatch(plain, /fold_print/);
  const matrix = [
    [1, 0, 0, 0],
    [0, 1, 0, 2.5],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const folded = compileToScad(a, catalogue, undefined, { matrix, split: false });
  assert.match(folded, /use <\.\.\/lib\/fold\.scad>/);
  assert.match(
    folded,
    /fold_print\(cut_y = 0, split = false\) multmatrix\(\[\[1, 0, 0, 0\], \[0, 1, 0, 2\.5\], \[0, 0, 1, 0\], \[0, 0, 0, 1\]\]\) \{\n {4}\S/,
  );
  assert.match(folded, /\n\}\n$/);
  assert.match(compileToScad(a, catalogue, undefined, { matrix, split: true }), /split = true/);
  assert.throws(() => compileToScad(a, catalogue, undefined, { matrix: [[1]], split: false }), /4 x 4/);
  const bad = matrix.map((row) => [...row]);
  bad[0][3] = NaN;
  assert.throws(() => compileToScad(a, catalogue, undefined, { matrix: bad, split: false }));
});

test("a fold survives a config round trip, and a bad or headless one doesn't load", () => {
  let a = createAssembly(PLATE.id, {});
  a = addChild(a, { parentId: ROOT_ID, partId: OPENCONNECT.id, params: { body: "none" }, slotName: "mount" });
  a = setFold(a, a.nodes[0].id, "split");
  const doc = serializeBenchConfig(a, catalogue);
  assert.deepEqual(doc.fold, { id: a.nodes[0].id, mode: "split" });
  const { assembly: back } = hydrateBenchConfig(JSON.parse(JSON.stringify(doc)), catalogue);
  assert.deepEqual(back.fold, { id: back.nodes[0].id, mode: "split" });

  assert.throws(() => checkBenchConfig({ ...doc, fold: { id: "root", mode: "origami" } }), /"fold"/);
  assert.throws(() => checkBenchConfig({ ...doc, fold: "root" }), /"fold"/);
  // The root is a plate: no head, so the fold is dropped, not fatal.
  assert.equal(
    hydrateBenchConfig({ ...doc, fold: { id: "root", mode: "folded" } }, catalogue).assembly.fold,
    undefined,
  );
});
